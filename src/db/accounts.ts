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

/**
 * Необязательные поля счёта, которые пользователь может СНЯТЬ (убрать лимит,
 * убрать дату окончания вклада). Их нельзя отправлять как `undefined`:
 * при сериализации в JSON такой ключ исчезает, на сервере остаётся прежнее
 * значение, и ближайший pull возвращает его обратно локально. Нужен явный null.
 */
const CLEARABLE_ACCOUNT_FIELDS = ['creditLimit', 'interestRate', 'capitalization', 'maturityDate', 'lastFour', 'isReplenishable'] as const

export async function updateAccount(id: string, patch: Partial<Account>): Promise<void> {
  const now = new Date().toISOString()
  await db.accounts.update(id, { ...patch, updatedAt: now })
  const fresh = await db.accounts.get(id)
  if (!fresh) return

  // то, что в патче пришло как undefined, уезжает наверх как null
  const payload: Record<string, unknown> = { ...fresh }
  for (const key of CLEARABLE_ACCOUNT_FIELDS) {
    if (key in patch && patch[key] === undefined) payload[key] = null
    else if (payload[key] === undefined) payload[key] = null
  }
  await enqueue('account', id, 'upsert', payload)
}

/**
 * Удаление — мягкое (tombstone). Жёсткое удаление ломало синхронизацию:
 * счёт возвращался ближайшим pull'ом, а операции оставались сиротами.
 * Если на счёте есть операции, он архивируется, а не удаляется.
 */
export async function removeAccount(id: string): Promise<'deleted' | 'archived'> {
  const used = await db.postings.where('accountId').equals(id).count()
  if (used > 0) {
    await updateAccount(id, { isArchived: 1 })
    return 'archived'
  }
  // локально удаляем сразу, наверх уезжает tombstone: проставлять deletedAt
  // перед самим удалением смысла не имело — строки уже нет
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

/**
 * Сумма вклада через `years` лет при ставке `rate` (% годовых).
 * `none` — без капитализации: проценты не прибавляются к телу, поэтому
 * формула простая, а не сложная. Раньше 'none' и 'atEnd' попадали в одну
 * ветку, и «без капитализации» ничем не отличалось от «в конце срока».
 */
function grow(balance: Minor, rate: number, years: number, cap: Account['capitalization']): Minor {
  const r = rate / 100
  switch (cap) {
    case 'monthly':   return Math.round(balance * Math.pow(1 + r / 12, 12 * years))
    case 'quarterly': return Math.round(balance * Math.pow(1 + r / 4, 4 * years))
    // 'none' и 'atEnd' — простые проценты на тело вклада
    default:          return Math.round(balance * (1 + r * years))
  }
}

/** Ожидаемая сумма вклада на дату погашения — с учётом капитализации. */
export function depositProjection(acc: Account, balance: Minor): Minor | null {
  if (acc.kind !== 'deposit' || !acc.interestRate || !acc.maturityDate) return null
  const end = new Date(acc.maturityDate).getTime()
  if (Number.isNaN(end)) return null
  const days = Math.max(0, (end - Date.now()) / 86_400_000)
  return grow(balance, acc.interestRate, days / 365, acc.capitalization)
}

export interface DepositInfo {
  /** сколько дней осталось до окончания; отрицательное — срок уже прошёл */
  daysLeft: number
  matured: boolean
  /** ожидаемая сумма на дату окончания */
  projected: Minor | null
  /** сколько процентов набежит до окончания */
  interest: Minor | null
  /** сколько уже начислено с даты открытия по сегодня */
  accrued: Minor | null
  replenishable: boolean
}

/**
 * Полная картинка по вкладу: и прогноз, и уже начисленное.
 * Начисленное считается от `openingBalance` на дату открытия — именно оно
 * отвечает на вопрос «сколько вклад уже принёс», которого на экране не было.
 */
export function depositInfo(acc: Account, balance: Minor): DepositInfo | null {
  if (acc.kind !== 'deposit') return null

  const end = acc.maturityDate ? new Date(acc.maturityDate).getTime() : NaN
  const hasEnd = !Number.isNaN(end)
  const daysLeft = hasEnd ? Math.ceil((end - Date.now()) / 86_400_000) : 0
  const projected = depositProjection(acc, balance)

  let accrued: Minor | null = null
  if (acc.interestRate) {
    const opened = new Date(acc.openingDate).getTime()
    if (!Number.isNaN(opened)) {
      // если срок уже прошёл, дальше проценты не капают
      const until = hasEnd ? Math.min(Date.now(), end) : Date.now()
      const years = Math.max(0, (until - opened) / 86_400_000) / 365
      accrued = grow(acc.openingBalance, acc.interestRate, years, acc.capitalization) - acc.openingBalance
    }
  }

  return {
    daysLeft,
    matured: hasEnd && daysLeft <= 0,
    projected,
    interest: projected != null ? projected - balance : null,
    accrued,
    replenishable: acc.isReplenishable === 1,
  }
}
