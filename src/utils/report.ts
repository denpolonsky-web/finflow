import { categoryColor, categoryName } from '../db/categories'
import { toMajor } from './money'
import type { Account, Minor, Profile, Transaction, TransactionType } from '../types'

/**
 * Движок «конструктора отчётов»: чистые функции, никакого React и никакой БД.
 * Экран только собирает конфиг и рисует то, что вернули отсюда.
 */

export type Metric = 'expense' | 'income' | 'net' | 'count' | 'avg'
export type GroupBy = 'category' | 'account' | 'profile' | 'type' | 'day' | 'week' | 'month' | 'weekday'
export type ChartKind = 'bar' | 'line' | 'area' | 'pie' | 'table'

export const METRICS: { id: Metric; label: string }[] = [
  { id: 'expense', label: 'Расходы' },
  { id: 'income', label: 'Доходы' },
  { id: 'net', label: 'Чистый поток' },
  { id: 'count', label: 'Количество' },
  { id: 'avg', label: 'Средний чек' },
]

export const GROUPS: { id: GroupBy; label: string }[] = [
  { id: 'category', label: 'Категория' },
  { id: 'account', label: 'Счёт' },
  { id: 'profile', label: 'Профиль' },
  { id: 'type', label: 'Тип' },
  { id: 'day', label: 'По дням' },
  { id: 'week', label: 'По неделям' },
  { id: 'month', label: 'По месяцам' },
  { id: 'weekday', label: 'День недели' },
]

export const CHARTS: { id: ChartKind; label: string }[] = [
  { id: 'bar', label: 'Столбцы' },
  { id: 'line', label: 'Линия' },
  { id: 'area', label: 'Область' },
  { id: 'pie', label: 'Круговая' },
  { id: 'table', label: 'Таблица' },
]

/** Разрезы, у которых есть естественный порядок по времени — их не сортируем по величине. */
const TIME_GROUPS: GroupBy[] = ['day', 'week', 'month', 'weekday']

export interface ReportFilters {
  /** пусто — все типы */
  types: TransactionType[]
  accountIds: string[]
  categoryIds: string[]
  profileIds: string[]
  search: string
  /** включать переводы и корректировки (по умолчанию они вне статистики) */
  includeExcluded: boolean
  minAmount: Minor | null
  maxAmount: Minor | null
}

export const EMPTY_FILTERS: ReportFilters = {
  types: [], accountIds: [], categoryIds: [], profileIds: [],
  search: '', includeExcluded: false, minAmount: null, maxAmount: null,
}

export function applyFilters(txs: Transaction[], f: ReportFilters): Transaction[] {
  const q = f.search.trim().toLowerCase()
  return txs.filter(t => {
    if (!f.includeExcluded && t.excludeFromStats) return false
    if (f.types.length && !f.types.includes(t.type)) return false
    if (f.accountIds.length
      && !f.accountIds.includes(t.accountId)
      && !(t.toAccountId && f.accountIds.includes(t.toAccountId))) return false
    if (f.categoryIds.length && !f.categoryIds.includes(t.categoryId)) return false
    if (f.profileIds.length && !f.profileIds.includes(t.profileId ?? '')) return false
    if (f.minAmount != null && t.amount < f.minAmount) return false
    if (f.maxAmount != null && t.amount > f.maxAmount) return false
    if (q) {
      const hay = `${t.title} ${t.comment ?? ''} ${categoryName(t.categoryId)}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Ключи группировки
// ─────────────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export interface LookupMaps {
  accounts: Account[]
  profiles: Profile[]
}

function keyOf(t: Transaction, by: GroupBy): string {
  const d = new Date(t.date)
  switch (by) {
    case 'category': return t.categoryId
    case 'account': return t.accountId
    case 'profile': return t.profileId ?? ''
    case 'type': return t.type
    case 'day': return t.date.slice(0, 10)
    case 'week': return isoWeekKey(d)
    case 'month': return t.date.slice(0, 7)
    case 'weekday': return String(d.getDay())
  }
}

function labelOf(key: string, by: GroupBy, maps: LookupMaps): string {
  switch (by) {
    case 'category': return categoryName(key)
    case 'account': return maps.accounts.find(a => a.id === key)?.name ?? 'Удалённый счёт'
    case 'profile': return key ? (maps.profiles.find(p => p.id === key)?.name ?? 'Удалённый профиль') : 'Без профиля'
    case 'type': return key === 'expense' ? 'Расход' : key === 'income' ? 'Доход' : 'Перевод'
    case 'day': { const [, m, dd] = key.split('-'); return `${dd}.${m}` }
    case 'week': return key.replace('-W', ' нед. ')
    case 'month': { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1]} ${y.slice(2)}` }
    case 'weekday': return WEEKDAYS[Number(key)]
  }
}

function colorOf(key: string, by: GroupBy, maps: LookupMaps, i: number): string {
  if (by === 'category') return categoryColor(key)
  if (by === 'account') return maps.accounts.find(a => a.id === key)?.color ?? '#6C63FF'
  if (by === 'profile') return maps.profiles.find(p => p.id === key)?.color ?? '#6C63FF'
  const palette = ['#6C63FF', '#00C896', '#FF8C42', '#E91E63', '#03A9F4', '#9C27B0', '#8BC34A']
  return palette[i % palette.length]
}

// ─────────────────────────────────────────────────────────────────────────────
// Агрегация
// ─────────────────────────────────────────────────────────────────────────────

interface Bucket { expense: number; income: number; count: number; expenseCount: number }

export interface ReportRow {
  key: string
  label: string
  color: string
  /** значение метрики: копейки для денежных метрик, штуки для 'count' */
  value: number
  count: number
  share: number
  /** изменение к сравниваемому периоду, % — null, если сравнения нет или база пустая */
  delta: number | null
}

function metricValue(b: Bucket, metric: Metric): number {
  switch (metric) {
    case 'expense': return b.expense
    case 'income': return b.income
    case 'net': return b.income - b.expense
    case 'count': return b.count
    case 'avg': return b.expenseCount > 0 ? Math.round(b.expense / b.expenseCount) : 0
  }
}

function bucketize(txs: Transaction[], by: GroupBy): Map<string, Bucket> {
  const m = new Map<string, Bucket>()
  for (const t of txs) {
    const k = keyOf(t, by)
    const b = m.get(k) ?? { expense: 0, income: 0, count: 0, expenseCount: 0 }
    b.count++
    if (t.type === 'expense') { b.expense += t.amount; b.expenseCount++ }
    if (t.type === 'income') b.income += t.amount
    m.set(k, b)
  }
  return m
}

export function buildReport(
  txs: Transaction[],
  by: GroupBy,
  metric: Metric,
  maps: LookupMaps,
  compareTxs: Transaction[] = [],
): ReportRow[] {
  const now = bucketize(txs, by)
  const before = bucketize(compareTxs, by)

  let rows: ReportRow[] = [...now.entries()].map(([key, b], i) => {
    const value = metricValue(b, metric)
    const prevBucket = before.get(key)
    const prev = prevBucket ? metricValue(prevBucket, metric) : 0
    return {
      key,
      label: labelOf(key, by, maps),
      color: colorOf(key, by, maps, i),
      value,
      count: b.count,
      share: 0,
      delta: compareTxs.length && prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : null,
    }
  })

  // Пустые строки выкидываем: при метрике «Расходы» категория дохода давала
  // строку с нулём, которая засоряла список и рисовала пустой сектор в круговой.
  // Для «Чистого потока» и «Количества» ноль осмыслен — там оставляем.
  if (metric !== 'net' && metric !== 'count') rows = rows.filter(r => r.value !== 0)

  const totalAbs = rows.reduce((s, r) => s + Math.abs(r.value), 0)
  for (const r of rows) r.share = totalAbs > 0 ? (Math.abs(r.value) / totalAbs) * 100 : 0

  if (TIME_GROUPS.includes(by)) {
    rows.sort((a, b2) => (by === 'weekday'
      ? ((Number(a.key) + 6) % 7) - ((Number(b2.key) + 6) % 7)   // неделя с понедельника
      : a.key.localeCompare(b2.key)))
  } else {
    rows.sort((a, b2) => Math.abs(b2.value) - Math.abs(a.value))
  }
  return rows
}

export function reportTotal(rows: ReportRow[], metric: Metric): number {
  if (metric === 'avg') {
    const totalCount = rows.reduce((s, r) => s + r.count, 0)
    const totalValue = rows.reduce((s, r) => s + r.value * r.count, 0)
    return totalCount > 0 ? Math.round(totalValue / totalCount) : 0
  }
  return rows.reduce((s, r) => s + r.value, 0)
}

export const isMoneyMetric = (m: Metric) => m !== 'count'

// ─────────────────────────────────────────────────────────────────────────────
// Выгрузка
// ─────────────────────────────────────────────────────────────────────────────

const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const num = (v: string | number) => String(v).replace('.', ',')

/** Агрегированная таблица — то, что видно на экране. */
export function reportToCsv(rows: ReportRow[], by: GroupBy, metric: Metric, title: string): string {
  const head = [
    GROUPS.find(g => g.id === by)?.label ?? 'Разрез',
    METRICS.find(m => m.id === metric)?.label ?? 'Значение',
    'Доля, %', 'Операций', 'Изм. к пред. периоду, %',
  ]
  const body = rows.map(r => [
    r.label,
    isMoneyMetric(metric) ? num(toMajor(r.value).toFixed(2)) : String(r.value),
    num(r.share.toFixed(1)),
    String(r.count),
    r.delta == null ? '' : num(r.delta.toFixed(1)),
  ].map(esc).join(';'))
  return '\uFEFF' + [esc(title), '', head.map(esc).join(';'), ...body].join('\r\n')
}

/** Сырые операции выборки — для Excel и сводных таблиц. */
export function rawToCsv(txs: Transaction[], maps: LookupMaps, title: string): string {
  const accName = new Map(maps.accounts.map(a => [a.id, a.name]))
  const profName = new Map(maps.profiles.map(p => [p.id, p.name]))
  const head = ['Дата', 'Время', 'Тип', 'Сумма', 'Категория', 'Счёт', 'Счёт зачисления',
    'Профиль', 'Название', 'Комментарий', 'Вне статистики']
  const body = [...txs]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(t => [
      t.date.slice(0, 10),
      t.date.slice(11, 16),
      t.type === 'expense' ? 'Расход' : t.type === 'income' ? 'Доход' : 'Перевод',
      num(toMajor(t.amount).toFixed(2)),
      categoryName(t.categoryId),
      accName.get(t.accountId) ?? t.accountId,
      t.toAccountId ? (accName.get(t.toAccountId) ?? t.toAccountId) : '',
      t.profileId ? (profName.get(t.profileId) ?? t.profileId) : '',
      t.title,
      t.comment ?? '',
      t.excludeFromStats ? 'да' : 'нет',
    ].map(esc).join(';'))
  return '\uFEFF' + [esc(title), '', head.map(esc).join(';'), ...body].join('\r\n')
}
