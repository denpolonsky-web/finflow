import Dexie, { type Table, type Transaction as DexieTx } from 'dexie'
import { v4 as uuid } from 'uuid'
import type {
  Account, Transaction, Posting, Goal, Budget,
  BalanceSnapshot, AppSettings, SyncQueueItem, MetaRow, Profile, CategoryRow,
} from '../types'

/**
 * ВНИМАНИЕ по индексам: IndexedDB не умеет индексировать boolean —
 * запись просто не попадает в индекс, а `.equals(false)` бросает DataError.
 * Поэтому все флаги хранятся как 0 | 1.
 */
class FinFlowDB extends Dexie {
  accounts!: Table<Account, string>
  transactions!: Table<Transaction, string>
  postings!: Table<Posting, string>
  goals!: Table<Goal, string>
  budgets!: Table<Budget, string>
  snapshots!: Table<BalanceSnapshot, string>
  settings!: Table<AppSettings, number>
  syncQueue!: Table<SyncQueueItem, string>
  meta!: Table<MetaRow, string>
  profiles!: Table<Profile, string>
  categories!: Table<CategoryRow, string>

  constructor() {
    super('FinFlowDB')

    // v1 / v2 — историческая схема (карты + вклады, суммы в рублях-float).
    this.version(1).stores({
      transactions: 'id, type, categoryId, cardId, date, createdAt, syncedAt, goalId',
      cards: 'id, bank',
      goals: 'id, isArchived, createdAt',
      recurringPayments: 'id, cardId, isActive',
      settings: 'id',
      syncQueue: 'id, entityType, entityId, createdAt',
    })
    this.version(2).stores({
      transactions: 'id, type, categoryId, cardId, date, createdAt, syncedAt, goalId',
      cards: 'id, bank',
      goals: 'id, isArchived, createdAt',
      deposits: 'id, isActive, expectedDate',
      recurringPayments: 'id, cardId, isActive',
      settings: 'id',
      syncQueue: 'id, entityType, entityId, createdAt',
    })

    // v3 — счета + проводки, суммы в копейках, флаги 0/1.
    this.version(3)
      .stores({
        accounts: 'id, kind, isArchived, sortOrder, updatedAt',
        transactions: 'id, type, categoryId, accountId, toAccountId, date, goalId, excludeFromStats, updatedAt, deletedAt',
        postings: 'id, transactionId, accountId, date',
        goals: 'id, isArchived, fundingAccountId, createdAt, updatedAt',
        budgets: 'id, categoryId, updatedAt',
        snapshots: 'id, accountId, at',
        settings: 'id',
        syncQueue: 'id, entityType, entityId, createdAt, dead',
        meta: 'key',
        // старые хранилища больше не нужны
        cards: null,
        deposits: null,
        recurringPayments: null,
      })
      .upgrade(migrateV2toV3)

    // v4 — подпрофили внутри одного аккаунта.
    this.version(4)
      .stores({
        profiles: 'id, role, isArchived, sortOrder, updatedAt',
        transactions: 'id, type, categoryId, accountId, toAccountId, date, goalId, excludeFromStats, profileId, updatedAt, deletedAt',
      })
      .upgrade(migrateV3toV4)

    // v5 — справочник категорий. Таблица создаётся ПУСТОЙ: встроенные категории
    // остаются в коде, сюда попадает только то, что завёл или изменил пользователь.
    // Поэтому переносить данные не нужно, и `.upgrade()` здесь только логирует.
    this.version(5)
      .stores({
        categories: 'id, type, isArchived, isCustom, sortOrder, updatedAt',
      })
      .upgrade(migrateV4toV5)
  }
}

export const db = new FinFlowDB()

// ─────────────────────────────────────────────────────────────────────────────
// Миграция старых данных
// ─────────────────────────────────────────────────────────────────────────────

interface OldCard { id: string; name: string; bank: string; balance: number; lastFour?: string; color: string; updatedAt: string }
interface OldDeposit { id: string; name: string; bank: string; amount: number; interestRate: number; expectedDate: string; color: string; createdAt: string; isActive: boolean }
interface OldTx { id: string; type: string; amount: number; categoryId: string; cardId: string; toCardId?: string; title: string; comment?: string; date: string; createdAt: string; updatedAt: string; goalId?: string }
interface OldGoal { id: string; title: string; icon: string; targetAmount: number; currentAmount: number; deadline?: string; createdAt: string; completedAt?: string; isArchived: boolean }

async function migrateV2toV3(tx: DexieTx) {
  const now = new Date().toISOString()
  const r = (n: unknown) => Math.round((Number(n) || 0) * 100)

  const oldCards = await tx.table('cards').toArray().catch(() => []) as OldCard[]
  const oldDeps = await tx.table('deposits').toArray().catch(() => []) as OldDeposit[]
  const oldTxs = await tx.table('transactions').toArray().catch(() => []) as OldTx[]
  const oldGoals = await tx.table('goals').toArray().catch(() => []) as OldGoal[]

  const accounts: Account[] = []
  const postings: Posting[] = []
  const transactions: Transaction[] = []

  // Сумма проводок по счёту, чтобы вычислить корректный openingBalance:
  // openingBalance = текущий_баланс − Σ проводок. Тогда после миграции
  // вычисляемый баланс совпадёт с тем, что пользователь видел раньше.
  const deltaByAccount = new Map<string, number>()
  const addDelta = (id: string, v: number) => deltaByAccount.set(id, (deltaByAccount.get(id) ?? 0) + v)

  for (const t of oldTxs) {
    const amount = Math.abs(r(t.amount))
    const type = t.type === 'income' ? 'income' : t.type === 'transfer' ? 'transfer' : 'expense'
    const legs: Posting[] = []
    if (type === 'income') {
      legs.push({ id: uuid(), transactionId: t.id, accountId: t.cardId, amount, date: t.date })
      addDelta(t.cardId, amount)
    } else if (type === 'expense') {
      legs.push({ id: uuid(), transactionId: t.id, accountId: t.cardId, amount: -amount, date: t.date })
      addDelta(t.cardId, -amount)
    } else {
      legs.push({ id: uuid(), transactionId: t.id, accountId: t.cardId, amount: -amount, date: t.date })
      addDelta(t.cardId, -amount)
      if (t.toCardId) {
        legs.push({ id: uuid(), transactionId: t.id, accountId: t.toCardId, amount, date: t.date })
        addDelta(t.toCardId, amount)
      }
    }
    postings.push(...legs)
    transactions.push({
      id: t.id,
      type: type as Transaction['type'],
      amount,
      categoryId: t.categoryId || 'other_exp',
      accountId: t.cardId,
      toAccountId: t.toCardId ?? null,
      title: t.title ?? '',
      comment: t.comment ?? null,
      tags: null,
      date: t.date,
      excludeFromStats: type === 'transfer' ? 1 : 0,
      goalId: t.goalId ?? null,
      source: 'manual',
      createdAt: t.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    })
  }

  oldCards.forEach((c, i) => {
    accounts.push({
      id: c.id, kind: 'debit', name: c.name, bank: c.bank, currency: 'RUB',
      openingBalance: r(c.balance) - (deltaByAccount.get(c.id) ?? 0),
      openingDate: '1970-01-01T00:00:00.000Z',
      lastFour: c.lastFour, color: c.color, isArchived: 0, sortOrder: i,
      createdAt: c.updatedAt ?? now, updatedAt: now, deletedAt: null,
    })
  })

  oldDeps.forEach((d, i) => {
    accounts.push({
      id: d.id, kind: 'deposit', name: d.name, bank: d.bank, currency: 'RUB',
      openingBalance: r(d.amount) - (deltaByAccount.get(d.id) ?? 0),
      openingDate: d.createdAt ?? '1970-01-01T00:00:00.000Z',
      color: d.color, isArchived: d.isActive === false ? 1 : 0, sortOrder: oldCards.length + i,
      interestRate: d.interestRate, capitalization: 'atEnd',
      maturityDate: d.expectedDate || null as unknown as string,
      isReplenishable: 0,
      createdAt: d.createdAt ?? now, updatedAt: now, deletedAt: null,
    })
  })

  // Счета, на которые ссылались операции, но которых нет (например, зашитый 'vtb')
  const known = new Set(accounts.map(a => a.id))
  for (const [accId, delta] of deltaByAccount) {
    if (known.has(accId)) continue
    accounts.push({
      id: accId, kind: 'debit', name: `Восстановленный счёт ${accId.slice(0, 6)}`,
      bank: 'other', currency: 'RUB',
      openingBalance: -delta, openingDate: '1970-01-01T00:00:00.000Z',
      color: '#6C63FF', isArchived: 0, sortOrder: accounts.length,
      createdAt: now, updatedAt: now, deletedAt: null,
    })
  }

  const goals: Goal[] = oldGoals.map(g => ({
    id: g.id, title: g.title, icon: g.icon || '🎯', kind: 'save',
    targetAmount: r(g.targetAmount), fundingAccountId: null,
    manualAmount: r(g.currentAmount),
    deadline: g.deadline || null, isArchived: g.isArchived ? 1 : 0,
    createdAt: g.createdAt ?? now, completedAt: g.completedAt ?? null,
    updatedAt: now, deletedAt: null,
  }))

  await tx.table('accounts').bulkPut(accounts)
  await tx.table('postings').bulkPut(postings)
  await tx.table('transactions').clear()
  await tx.table('transactions').bulkPut(transactions)
  await tx.table('goals').clear()
  await tx.table('goals').bulkPut(goals)
  // очередь старого формата несовместима — начинаем с чистого листа,
  // полный заливной push сделает первый же sync
  await tx.table('syncQueue').clear()

  console.info('[migrate v2→v3]', {
    accounts: accounts.length, transactions: transactions.length,
    postings: postings.length, goals: goals.length,
  })
}

/**
 * Первый подпрофиль получает ФИКСИРОВАННЫЙ id. Это важно: миграция проходит
 * на каждом устройстве независимо, и случайный uuid породил бы два «основных»
 * профиля, которые потом склеились бы в облаке в мусор.
 */
export const PRIMARY_PROFILE_ID = 'primary'

async function migrateV3toV4(tx: DexieTx) {
  const now = new Date().toISOString()
  const settings = await tx.table('settings').get(1).catch(() => undefined)

  await tx.table('profiles').put({
    id: PRIMARY_PROFILE_ID,
    name: (settings as { userName?: string } | undefined)?.userName?.trim() || 'Основной',
    emoji: '👤',
    color: '#6C63FF',
    role: 'primary',
    pinHash: null,
    isArchived: 0,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })

  // Старые операции принадлежат основному профилю. Присваиваем детерминированно
  // и НЕ ставим в очередь отправки: на каждом устройстве получится тот же
  // profileId, так что облако и так сойдётся, а пуш тысяч строк не нужен.
  await tx.table('transactions').toCollection().modify((t: Record<string, unknown>) => {
    if (!t.profileId) t.profileId = PRIMARY_PROFILE_ID
  })

  console.info('[migrate v3→v4] подпрофили включены')
}

/**
 * v4 → v5. Данные не переносятся намеренно: встроенные категории живут в коде,
 * а таблица хранит только пользовательские и переопределения. Пустая таблица —
 * это корректное состояние «пользователь ничего не менял».
 */
async function migrateV4toV5() {
  console.info('[migrate v4→v5] справочник категорий подключён')
}

// ─────────────────────────────────────────────────────────────────────────────
// Настройки / meta
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  userName: '',
  currency: 'RUB',
  theme: 'dark',
  runwayWindowMonths: 3,
  updatedAt: new Date().toISOString(),
}

export async function getSettings(): Promise<AppSettings | undefined> {
  return db.settings.get(1)
}

export async function isFirstLaunch(): Promise<boolean> {
  return !(await db.settings.get(1))
}

export async function getMeta(key: string): Promise<string | null> {
  return (await db.meta.get(key))?.value ?? null
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value })
}

/** Полная очистка локальных данных — при выходе из аккаунта или смене пользователя. */
export async function wipeLocal(): Promise<void> {
  await db.transaction('rw', [
    db.accounts, db.transactions, db.postings, db.goals,
    db.budgets, db.snapshots, db.settings, db.syncQueue, db.meta, db.profiles,
    db.categories,
  ], async () => {
    await Promise.all([
      db.accounts.clear(), db.transactions.clear(), db.postings.clear(),
      db.goals.clear(), db.budgets.clear(), db.snapshots.clear(),
      db.settings.clear(), db.syncQueue.clear(), db.meta.clear(),
      db.profiles.clear(), db.categories.clear(),
    ])
  })
}
