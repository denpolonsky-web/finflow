import { v4 as uuid } from 'uuid'
import { db } from './index'
import { enqueue } from './queue'
import { TRANSFER_CATEGORY_ID } from './categories'
import { resolveProfileId } from './profiles'
import type { Minor, Posting, Transaction, TransactionType } from '../types'

export interface TxInput {
  type: TransactionType
  amount: Minor               // всегда положительная
  categoryId: string
  accountId: string
  toAccountId?: string | null
  title?: string
  comment?: string | null
  tags?: string[] | null
  date?: string
  goalId?: string | null
  /** если не передан — берётся активный подпрофиль */
  profileId?: string | null
  source?: Transaction['source']
  excludeFromStats?: 0 | 1
}

export class LedgerError extends Error {}

function validate(i: TxInput) {
  if (!Number.isInteger(i.amount) || i.amount <= 0) {
    throw new LedgerError('Сумма должна быть больше нуля')
  }
  if (!i.accountId) throw new LedgerError('Не выбран счёт')
  if (i.type === 'transfer') {
    if (!i.toAccountId) throw new LedgerError('Не выбран счёт зачисления')
    if (i.toAccountId === i.accountId) throw new LedgerError('Счета перевода совпадают')
  }
}

/** Проводки операции. Перевод всегда даёт две ноги — поэтому деньги не могут «испариться». */
function buildPostings(txId: string, i: TxInput, date: string): Posting[] {
  const legs: Posting[] = []
  if (i.type === 'income') {
    legs.push({ id: uuid(), transactionId: txId, accountId: i.accountId, amount: i.amount, date })
  } else if (i.type === 'expense') {
    legs.push({ id: uuid(), transactionId: txId, accountId: i.accountId, amount: -i.amount, date })
  } else {
    legs.push({ id: uuid(), transactionId: txId, accountId: i.accountId, amount: -i.amount, date })
    legs.push({ id: uuid(), transactionId: txId, accountId: i.toAccountId!, amount: i.amount, date })
  }
  return legs
}

export async function addTransaction(input: TxInput): Promise<Transaction> {
  validate(input)
  const now = new Date().toISOString()
  const date = input.date ?? now
  const id = uuid()

  const tx: Transaction = {
    id,
    type: input.type,
    amount: input.amount,
    categoryId: input.type === 'transfer' ? TRANSFER_CATEGORY_ID : input.categoryId,
    accountId: input.accountId,
    toAccountId: input.type === 'transfer' ? input.toAccountId! : null,
    title: input.title?.trim() || '',
    comment: input.comment ?? null,
    tags: input.tags ?? null,
    date,
    // перевод между своими счетами — не расход и не доход
    excludeFromStats: input.excludeFromStats ?? (input.type === 'transfer' ? 1 : 0),
    goalId: input.goalId ?? null,
    profileId: input.profileId ?? await resolveProfileId(),
    source: input.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  const legs = buildPostings(id, input, date)

  await db.transaction('rw', [db.transactions, db.postings, db.syncQueue], async () => {
    await db.transactions.add(tx)
    await db.postings.bulkAdd(legs)
  })

  await enqueue('transaction', id, 'upsert', tx)
  for (const l of legs) await enqueue('posting', l.id, 'upsert', l)
  return tx
}

/**
 * Редактирование пересобирает проводки целиком. Старая версия меняла только
 * поля транзакции и не трогала баланс счёта — расхождение оставалось навсегда.
 */
export async function updateTransaction(id: string, input: TxInput): Promise<void> {
  validate(input)
  const existing = await db.transactions.get(id)
  if (!existing) throw new LedgerError('Операция не найдена')

  const now = new Date().toISOString()
  const date = input.date ?? existing.date
  const oldLegs = await db.postings.where('transactionId').equals(id).toArray()
  const newLegs = buildPostings(id, input, date)

  const tx: Transaction = {
    ...existing,
    type: input.type,
    amount: input.amount,
    categoryId: input.type === 'transfer' ? TRANSFER_CATEGORY_ID : input.categoryId,
    accountId: input.accountId,
    toAccountId: input.type === 'transfer' ? input.toAccountId! : null,
    title: input.title?.trim() ?? existing.title,
    comment: input.comment ?? null,
    tags: input.tags ?? null,
    date,
    excludeFromStats: input.excludeFromStats ?? (input.type === 'transfer' ? 1 : 0),
    goalId: input.goalId ?? null,
    // владелец операции при редактировании не меняется
    profileId: input.profileId ?? existing.profileId ?? await resolveProfileId(),
    updatedAt: now,
  }

  await db.transaction('rw', [db.transactions, db.postings, db.syncQueue], async () => {
    await db.postings.bulkDelete(oldLegs.map(l => l.id))
    await db.postings.bulkAdd(newLegs)
    await db.transactions.put(tx)
  })

  for (const l of oldLegs) await enqueue('posting', l.id, 'delete', null)
  for (const l of newLegs) await enqueue('posting', l.id, 'upsert', l)
  await enqueue('transaction', id, 'upsert', tx)
}

/**
 * Мягкое удаление: проводки снимаются (баланс возвращается), на сервер уходит
 * tombstone, а сама операция кладётся в локальную корзину — оттуда её можно
 * вернуть. Раньше удаление было необратимым: промах пальцем по кнопке под
 * «Сохранить» стоил операции без следа.
 */
export async function deleteTransaction(id: string): Promise<void> {
  const existing = await db.transactions.get(id)
  const legs = await db.postings.where('transactionId').equals(id).toArray()
  const now = new Date().toISOString()
  await db.transaction('rw', [db.transactions, db.postings, db.trash], async () => {
    await db.postings.bulkDelete(legs.map(l => l.id))
    await db.transactions.delete(id)
    if (existing) await db.trash.put({ id, tx: { ...existing, deletedAt: now }, deletedAt: now })
  })
  for (const l of legs) await enqueue('posting', l.id, 'delete', null)
  await enqueue('transaction', id, 'delete', null)
}

/** Сколько дней операция лежит в корзине, прежде чем уйти из неё насовсем. */
export const TRASH_KEEP_DAYS = 90

/**
 * Возврат операции из корзины.
 *
 * Проводки собираются ЗАНОВО из самой операции, с новыми id: старые ушли
 * на сервер tombstone'ами, и оживлять их незачем — баланс всё равно считается
 * суммой живых проводок. Операция возвращается под своим прежним id, поэтому
 * upsert в очереди схлопывает неотправленное удаление (если оно ещё не уехало),
 * а на сервере снимает `deleted_at` с уже удалённой строки.
 */
export async function restoreTransaction(id: string): Promise<Transaction> {
  const item = await db.trash.get(id)
  if (!item) throw new LedgerError('Операции нет в корзине')

  // уже вернулась — с другого устройства или повторным нажатием
  const alive = await db.transactions.get(id)
  if (alive) { await db.trash.delete(id); return alive }

  const src = item.tx
  if (!(await db.accounts.get(src.accountId))) {
    throw new LedgerError('Счёт этой операции удалён — вернуть её некуда')
  }
  if (src.type === 'transfer' && !(src.toAccountId && await db.accounts.get(src.toAccountId))) {
    throw new LedgerError('Счёт зачисления удалён — перевод вернуть некуда')
  }

  const now = new Date().toISOString()
  const tx: Transaction = { ...src, updatedAt: now, deletedAt: null }
  const input: TxInput = {
    type: tx.type, amount: tx.amount, categoryId: tx.categoryId,
    accountId: tx.accountId, toAccountId: tx.toAccountId ?? null,
  }
  validate(input)
  const legs = buildPostings(id, input, tx.date)

  await db.transaction('rw', [db.transactions, db.postings, db.trash], async () => {
    await db.transactions.put(tx)
    await db.postings.bulkAdd(legs)
    await db.trash.delete(id)
  })

  await enqueue('transaction', id, 'upsert', tx)
  for (const l of legs) await enqueue('posting', l.id, 'upsert', l)
  return tx
}

/** Убрать одну операцию из корзины насовсем. На сервере она и так удалена. */
export async function dropFromTrash(id: string): Promise<void> {
  await db.trash.delete(id)
}

/** Очистить корзину целиком. */
export async function emptyTrash(): Promise<void> {
  await db.trash.clear()
}

/**
 * Выбросить из корзины то, что лежит дольше `TRASH_KEEP_DAYS`. `now` — параметр,
 * чтобы тест не зависел от текущего времени.
 */
export async function purgeOldTrash(now = Date.now()): Promise<number> {
  const border = new Date(now - TRASH_KEEP_DAYS * 86_400_000).toISOString()
  return db.trash.where('deletedAt').below(border).delete()
}

/**
 * Сверка с банком: разница между вычисленным и фактическим балансом
 * записывается отдельной операцией-корректировкой. Такие операции помечены
 * excludeFromStats, чтобы не искажать статистику расходов — в прошлой версии
 * они падали в обычную категорию «Другое».
 */
export async function reconcileAccount(
  accountId: string,
  statedBalance: Minor,
  derivedBalance: Minor,
  opts: { record: boolean; categoryId?: string; title?: string },
): Promise<void> {
  const gap = statedBalance - derivedBalance
  const now = new Date().toISOString()

  if (opts.record && gap !== 0) {
    await addTransaction({
      type: gap > 0 ? 'income' : 'expense',
      amount: Math.abs(gap),
      categoryId: opts.categoryId ?? (gap > 0 ? 'adjust_inc' : 'adjust_exp'),
      accountId,
      title: opts.title || 'Корректировка баланса',
      source: 'reconciliation',
      excludeFromStats: 1,
      date: now,
    })
  }

  const snap = {
    id: uuid(), accountId, at: now,
    statedBalance, derivedBalance, gap,
    resolution: (opts.record ? 'adjusted' : 'ignored') as 'adjusted' | 'ignored',
    createdAt: now, updatedAt: now, deletedAt: null,
  }
  await db.snapshots.add(snap)
  await enqueue('snapshot', snap.id, 'upsert', snap)
}
