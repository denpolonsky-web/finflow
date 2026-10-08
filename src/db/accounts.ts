import { v4 as uuid } from 'uuid'
import { db } from './index'
import { enqueue } from './queue'
import type { Account, AccountKind, Minor } from '../types'

export const BANK_PRESETS = [
  { id: 'vtb',   name: 'ВТБ',    color: '#005CA9', gradient: 'from-blue-700 to-blue-900' },
  { id: 'tbank', name: 'Т-Банк', color: '#B8860B', gradient: 'from-yellow-600 to-yellow-800' },
  { id: 'sber',  name: 'Сбер',   color: '#21A038', gradient: 'from-green-600 to-green-800' },
  { id: 'alfa',  name: 'Альфа',  color: '#EF3124', gradient: 'from-red-500 to-red-700' },
  { id: 'ozon',  name: 'Озон',   color: '#0069FF', gradient: 'from-sky-600 to-blue-800' },
  { id: 'other', name: 'Другой', color: '#6C63FF', gradient: 'from-violet-600 to-indigo-700' },
]

export const ACCOUNT_KINDS: { id: AccountKind; label: string; icon: string }[] = [
  { id: 'debit',   label: 'Дебетовая', icon: '💳' },
  { id: 'credit',  label: 'Кредитка',  icon: '🪙' },
  { id: 'cash',    label: 'Наличные',  icon: '💵' },
  { id: 'savings', label: 'Накопит.',  icon: '🏦' },
  { id: 'deposit', label: 'Вклад',     icon: '🐷' },
]

export function bankPreset(id: string) {
  return BANK_PRESETS.find(p => p.id === id) ?? BANK_PRESETS[BANK_PRESETS.length - 1]
}

export function kindLabel(k: AccountKind): string {
  return ACCOUNT_KINDS.find(x => x.id === k)?.label ?? k
}

export interface AccountInput {
  kind: AccountKind
  name: string
  bank: string
  openingBalance: Minor
  lastFour?: string
  creditLimit?: Minor
  interestRate?: number
  capitalization?: Account['capitalization']
  maturityDate?: string | null
  isReplenishable?: 0 | 1
}

export async function createAccount(input: AccountInput): Promise<Account> {
  const now = new Date().toISOString()
  const count = await db.accounts.count()
  const acc: Account = {
    id: uuid(),
    kind: input.kind,
    name: input.name.trim() || bankPreset(input.bank).name,
    bank: input.bank,
    currency: 'RUB',
    openingBalance: input.openingBalance,
    openingDate: now,
    lastFour: input.lastFour || undefined,
    color: bankPreset(input.bank).color,
    isArchived: 0,
    sortOrder: count,
    creditLimit: input.creditLimit,
    interestRate: input.interestRate,
    capitalization: input.capitalization,
    maturityDate: input.maturityDate || undefined,
    isReplenishable: input.isReplenishable,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  await db.accounts.add(acc)
  await enqueue('account', acc.id, 'upsert', acc)
  return acc
}

export async function updateAccount(id: string, patch: Partial<Account>): Promise<void> {
  const now = new Date().toISOString()
  await db.accounts.update(id, { ...patch, updatedAt: now })
  const fresh = await db.accounts.get(id)
  if (fresh) await enqueue('account', id, 'upsert', fresh)
}

/**
 * Удаление — мягкое (tombstone). Жёсткое удаление ломало синхронизацию:
 * счёт возвращался ближайшим pull'ом, а операции оставались сиротами.
 * Если на счёте есть операции, он архивируется, а не удаляется.
 */
export async function removeAccount(id: string): Promise<'deleted' | 'archived'> {
  const used = await db.postings.where('accountId').equals(id).count()
  const now = new Date().toISOString()
  if (used > 0) {
    await updateAccount(id, { isArchived: 1 })
    return 'archived'
  }
  await db.accounts.update(id, { deletedAt: now, updatedAt: now })
  await db.accounts.delete(id)
  await enqueue('account', id, 'delete', null)
  return 'deleted'
}

/**
 * Балансы всех счетов: openingBalance + Σ проводок.
 * Баланс НИГДЕ не хранится как изменяемое поле — это и есть причина, по которой
 * правка/удаление/перевод больше не могут его рассинхронизировать.
 */
export async function computeBalances(): Promise<Map<string, Minor>> {
  const [accounts, postings] = await Promise.all([
    db.accounts.toArray(),
    db.postings.toArray(),
  ])
  const map = new Map<string, number>()
  for (const a of accounts) map.set(a.id, a.openingBalance)
  for (const p of postings) map.set(p.accountId, (map.get(p.accountId) ?? 0) + p.amount)
  return map
}

export async function accountBalance(id: string): Promise<Minor> {
  const acc = await db.accounts.get(id)
  if (!acc) return 0
  const postings = await db.postings.where('accountId').equals(id).toArray()
  return acc.openingBalance + postings.reduce((s, p) => s + p.amount, 0)
}

/** Доступно к трате по кредитке: лимит + баланс (баланс отрицательный при долге). */
export function availableCredit(acc: Account, balance: Minor): Minor | null {
  if (acc.kind !== 'credit' || acc.creditLimit == null) return null
  return acc.creditLimit + balance
}

/** Ожидаемая сумма вклада на дату погашения — с учётом капитализации. */
export function depositProjection(acc: Account, balance: Minor): Minor | null {
  if (acc.kind !== 'deposit' || !acc.interestRate || !acc.maturityDate) return null
  const end = new Date(acc.maturityDate).getTime()
  if (Number.isNaN(end)) return null
  const days = Math.max(0, (end - Date.now()) / 86_400_000)
  const years = days / 365
  const r = acc.interestRate / 100
  switch (acc.capitalization) {
    case 'monthly':   return Math.round(balance * Math.pow(1 + r / 12, 12 * years))
    case 'quarterly': return Math.round(balance * Math.pow(1 + r / 4, 4 * years))
    default:          return Math.round(balance * (1 + r * years))
  }
}
