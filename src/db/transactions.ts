import { v4 as uuid } from 'uuid'
import { db } from './index'
import { enqueue } from './queue'
import { TRANSFER_CATEGORY_ID } from './categories'
import { getActiveProfileId } from './profiles'
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
    profileId: input.profileId ?? getActiveProfileId(),
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
    profileId: input.profileId ?? existing.profileId ?? getActiveProfileId(),
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

/** Мягкое удаление: проводки снимаются (баланс возвращается), на сервер уходит tombstone. */
export async function deleteTransaction(id: string): Promise<void> {
  const legs = await db.postings.where('transactionId').equals(id).toArray()
  await db.transaction('rw', [db.transactions, db.postings, db.syncQueue], async () => {
    await db.postings.bulkDelete(legs.map(l => l.id))
    await db.transactions.delete(id)
  })
  for (const l of legs) await enqueue('posting', l.id, 'delete', null)
  await enqueue('transaction', id, 'delete', null)
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
