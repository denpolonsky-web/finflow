export type TransactionType = 'expense' | 'income' | 'transfer'
export type CardId = string

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  type: 'expense' | 'income' | 'both'
  isCustom?: boolean
}

export interface Transaction {
  id: string
  type: TransactionType
  amount: number
  categoryId: string
  cardId: CardId
  toCardId?: CardId
  title: string
  comment?: string
  tags?: string[]
  date: string
  createdAt: string
  updatedAt: string
  syncedAt?: string
  goalId?: string
}

export interface Card {
  id: string
  name: string
  bank: string
  balance: number
  lastFour?: string
  color: string
  updatedAt: string
}

export interface Deposit {
  id: string
  name: string
  bank: string
  amount: number          // текущая сумма
  interestRate: number    // % годовых
  expectedDate: string    // дата поступления (ISO)
  expectedAmount: number  // ожидаемая сумма с процентами
  color: string
  createdAt: string
  isActive: boolean
}

export interface Goal {
  id: string
  title: string
  icon: string
  targetAmount: number
  currentAmount: number
  deadline?: string
  createdAt: string
  completedAt?: string
  isArchived: boolean
}

export interface RecurringPayment {
  id: string
  title: string
  amount: number
  cardId: CardId
  categoryId: string
  dayOfMonth: number
  isActive: boolean
}

export interface CategoryLimit {
  categoryId: string
  amount: number
  period: 'month' | 'week'
}

export interface AppSettings {
  userName: string
  dailyLimit?: number
  categoryLimits: CategoryLimit[]
  reminderDay?: number
  reminderHour?: number
  theme: 'dark' | 'light'
  currency: '₽'
}

export interface SyncQueueItem {
  id: string
  entityType: 'transaction' | 'goal' | 'card' | 'settings' | 'deposit'
  entityId: string
  operation: 'create' | 'update' | 'delete'
  payload: unknown
  createdAt: string
}

export type TabId = 'home' | 'transactions' | 'add' | 'stats' | 'goals' | 'cards'
export type Period = 'week' | 'month' | 'quarter' | 'year' | 'custom'
