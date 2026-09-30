import Dexie, { type Table } from 'dexie'
import type { Transaction, Card, Goal, Deposit, RecurringPayment, AppSettings, SyncQueueItem } from '../types'

class FinFlowDB extends Dexie {
  transactions!: Table<Transaction>
  cards!: Table<Card>
  goals!: Table<Goal>
  deposits!: Table<Deposit>
  recurringPayments!: Table<RecurringPayment>
  settings!: Table<AppSettings & { id: 1 }>
  syncQueue!: Table<SyncQueueItem>

  constructor() {
    super('FinFlowDB')
    this.version(1).stores({
      transactions: 'id, type, categoryId, cardId, date, createdAt, syncedAt, goalId',
      cards: 'id, bank',
      goals: 'id, isArchived, createdAt',
      recurringPayments: 'id, cardId, isActive',
      settings: 'id',
      syncQueue: 'id, entityType, entityId, createdAt',
    })
    // v2 — add deposits
    this.version(2).stores({
      transactions: 'id, type, categoryId, cardId, date, createdAt, syncedAt, goalId',
      cards: 'id, bank',
      goals: 'id, isArchived, createdAt',
      deposits: 'id, isActive, expectedDate',
      recurringPayments: 'id, cardId, isActive',
      settings: 'id',
      syncQueue: 'id, entityType, entityId, createdAt',
    })
  }
}

export const db = new FinFlowDB()

export async function isFirstLaunch(): Promise<boolean> {
  const s = await db.settings.get(1)
  return !s
}

export async function seedDefaultUser(): Promise<void> {
  const exists = await db.settings.get(1)
  if (exists) return
  await db.settings.put({
    id: 1 as 1,
    userName: 'Denis',
    categoryLimits: [],
    theme: 'dark',
    currency: '₽',
  })
}
