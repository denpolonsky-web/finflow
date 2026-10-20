// ─────────────────────────────────────────────────────────────────────────────
// ВАЖНО: все денежные суммы хранятся в МИНОРНЫХ ЕДИНИЦАХ (копейках), целым числом.
// 1 234,56 ₽  →  123456
// ─────────────────────────────────────────────────────────────────────────────

export type Minor = number

export type TransactionType = 'expense' | 'income' | 'transfer'

export type AccountKind = 'debit' | 'cash' | 'savings' | 'deposit' | 'credit'

export type Currency = 'RUB'

export type Capitalization = 'none' | 'monthly' | 'quarterly' | 'atEnd'

/** Флаг в индексируемых полях: IndexedDB не умеет индексировать boolean. */
export type Flag = 0 | 1

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  type: 'expense' | 'income' | 'both'
  /** обязательная трата (ЖКХ, связь) vs дискреционная (развлечения) */
  essential?: boolean
}

export interface Account {
  id: string
  kind: AccountKind
  name: string
  bank: string
  currency: Currency
  /** остаток на openingDate; текущий баланс = openingBalance + Σ postings */
  openingBalance: Minor
  openingDate: string
  lastFour?: string
  color: string
  isArchived: Flag
  sortOrder: number
  // credit
  creditLimit?: Minor
  // deposit
  interestRate?: number
  capitalization?: Capitalization
  maturityDate?: string
  isReplenishable?: Flag
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

/** Роль подпрофиля внутри одного общего кабинета. */
export type ProfileRole = 'primary' | 'member'

/**
 * Подпрофиль. Все подпрофили живут ВНУТРИ одного Supabase-аккаунта и делят
 * один user_id — поэтому синхронизация и RLS не меняются.
 * ВАЖНО: роль разграничивает интерфейс, а не доступ к данным. Человек с
 * доступом к устройству и токену технически видит всё.
 */
export interface Profile {
  id: string
  name: string
  emoji: string
  color: string
  role: ProfileRole
  /** SHA-256 от пин-кода; null — вход в профиль без пин-кода */
  pinHash?: string | null
  isArchived: Flag
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface Transaction {
  id: string
  type: TransactionType
  /** всегда положительная величина; знак живёт в postings */
  amount: Minor
  categoryId: string
  accountId: string
  toAccountId?: string | null
  title: string
  comment?: string | null
  tags?: string[] | null
  date: string
  /** переводы между своими счетами и корректировки не идут в расходы/доходы */
  excludeFromStats: Flag
  goalId?: string | null
  /** какой подпрофиль завёл операцию; null — досталась от миграции */
  profileId?: string | null
  source: 'manual' | 'reconciliation' | 'goal' | 'import'
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

/** Одна «нога» операции. Баланс счёта = openingBalance + Σ amount всех его postings. */
export interface Posting {
  id: string
  transactionId: string
  accountId: string
  /** знаковая сумма: + приход, − расход */
  amount: Minor
  date: string
}

export type GoalKind = 'save' | 'cushion'

export interface Goal {
  id: string
  title: string
  icon: string
  kind: GoalKind
  targetAmount: Minor
  /** если задан — currentAmount берётся из баланса этого счёта, а не вводится руками */
  fundingAccountId?: string | null
  /** ручной режим: сколько уже накоплено (когда счёт не привязан) */
  manualAmount: Minor
  /** для kind='cushion': на сколько месяцев расходов копим */
  cushionMonths?: number
  deadline?: string | null
  isArchived: Flag
  createdAt: string
  completedAt?: string | null
  updatedAt: string
  deletedAt?: string | null
}

export interface Budget {
  id: string
  categoryId: string
  amount: Minor
  period: 'month'
  updatedAt: string
  deletedAt?: string | null
}

/** Снимок сверки с реальным балансом в банке. */
export interface BalanceSnapshot {
  id: string
  accountId: string
  at: string
  statedBalance: Minor
  derivedBalance: Minor
  gap: Minor
  resolution: 'adjusted' | 'ignored'
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface AppSettings {
  id: 1
  userName: string
  currency: Currency
  theme: 'dark'
  /** сколько месяцев берём для расчёта runway и «подушки» */
  runwayWindowMonths: number
  updatedAt: string
}

export type SyncEntity =
  | 'account' | 'transaction' | 'posting' | 'goal' | 'budget' | 'snapshot' | 'settings' | 'profile'

export interface SyncQueueItem {
  id: string
  entityType: SyncEntity
  entityId: string
  operation: 'upsert' | 'delete'
  payload: unknown
  createdAt: string
  retryCount: number
  lastError?: string | null
  /** 1 — перестали пытаться, показываем пользователю */
  dead: Flag
}

export interface MetaRow {
  key: string
  value: string
}

export type TabId = 'home' | 'transactions' | 'stats' | 'accounts' | 'goals' | 'settings'
export type PeriodId = 'week' | 'month' | 'quarter' | 'year' | 'custom'

export interface Range {
  from: Date
  to: Date
  label: string
}
