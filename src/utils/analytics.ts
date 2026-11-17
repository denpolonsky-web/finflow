import { getCategory } from '../db/categories'
import type { Budget, Minor, Range, Transaction } from '../types'
import { periodProgress } from './period'
import { dateKey, isoDateOnly } from './format'

/** В расходы/доходы идут только операции без флага excludeFromStats. */
export function statsOnly(txs: Transaction[]): Transaction[] {
  return txs.filter(t => !t.excludeFromStats)
}

export interface Totals {
  expense: Minor
  income: Minor
  net: Minor
  /** доля дохода, которая осталась: (доход − расход) / доход */
  savingsRate: number | null
  essential: Minor
  discretionary: Minor
  txCount: number
}

export function totals(txs: Transaction[]): Totals {
  const s = statsOnly(txs)
  let expense = 0, income = 0, essential = 0, discretionary = 0
  for (const t of s) {
    if (t.type === 'income') { income += t.amount; continue }
    if (t.type !== 'expense') continue
    expense += t.amount
    if (getCategory(t.categoryId)?.essential) essential += t.amount
    else discretionary += t.amount
  }
  return {
    expense, income, net: income - expense,
    savingsRate: income > 0 ? ((income - expense) / income) * 100 : null,
    essential, discretionary, txCount: s.length,
  }
}

export interface CategoryRow {
  categoryId: string
  amount: Minor
  share: number
  count: number
  /** изменение к прошлому периоду, % */
  delta: number | null
}

export function byCategory(txs: Transaction[], prev: Transaction[] = []): CategoryRow[] {
  const agg = (list: Transaction[]) => {
    const m = new Map<string, { amount: number; count: number }>()
    for (const t of statsOnly(list)) {
      if (t.type !== 'expense') continue
      const cur = m.get(t.categoryId) ?? { amount: 0, count: 0 }
      cur.amount += t.amount; cur.count++
      m.set(t.categoryId, cur)
    }
    return m
  }
  const now = agg(txs), before = agg(prev)
  const total = [...now.values()].reduce((s, v) => s + v.amount, 0)

  return [...now.entries()]
    .map(([categoryId, v]) => {
      const p = before.get(categoryId)?.amount ?? 0
      return {
        categoryId,
        amount: v.amount,
        count: v.count,
        share: total > 0 ? (v.amount / total) * 100 : 0,
        delta: p > 0 ? ((v.amount - p) / p) * 100 : null,
      }
    })
    // тай-брейк по id: при равных суммах порядок иначе зависит от порядка вставки
    // в Map и «плавает» между перерисовками
    .sort((a, b) => b.amount - a.amount || a.categoryId.localeCompare(b.categoryId))
}

export interface BiggestExpense {
  tx: Transaction
  /** доля этой траты от всех расходов выборки, % */
  share: number
}

/**
 * Самая крупная трата выборки. Факт, а не прогноз: либо она есть, либо
 * расходов нет вовсе и блок молчит.
 *
 * Переводы и операции вне статистики не участвуют — иначе «крупнейшей тратой
 * месяца» оказывался бы перевод на свой же счёт.
 *
 * Тай-брейк по `id`: при двух одинаковых суммах порядок иначе зависел бы
 * от порядка выборки и «плавал» между перерисовками.
 */
export function biggestExpense(txs: Transaction[]): BiggestExpense | null {
  const list = statsOnly(txs).filter(t => t.type === 'expense')
  if (!list.length) return null
  let top = list[0]
  let total = 0
  for (const t of list) {
    total += t.amount
    if (t.amount > top.amount || (t.amount === top.amount && t.id < top.id)) top = t
  }
  return { tx: top, share: total > 0 ? (top.amount / total) * 100 : 0 }
}

export interface DayPoint { date: string; label: string; expense: Minor; income: Minor; cumulative: Minor }

/**
 * Предохранитель от бесконечного цикла на битом диапазоне — два года с запасом.
 * Прежний предел в 400 точек молча обрезал произвольный период длиннее ~13 месяцев.
 */
const MAX_DAY_POINTS = 740

/**
 * Непрерывная шкала дней периода: для графика по дням и накопительной кривой.
 *
 * День — ЛОКАЛЬНЫЙ, и у операций, и у самой шкалы (`dateKey`). На срезе
 * ISO-строки это было сломано дважды: операция попадала в день по UTC,
 * а шкала строилась от `range.from` (локальной полуночи), чей `toISOString()`
 * в плюсовом поясе указывает на предыдущие сутки. В Москве весь график
 * уезжал на день: столбик «1 ноября» показывал траты 31 октября, а последний
 * день периода не попадал в шкалу вовсе.
 */
export function byDay(txs: Transaction[], range: Range): DayPoint[] {
  const map = new Map<string, { expense: number; income: number }>()
  for (const t of statsOnly(txs)) {
    const key = isoDateOnly(t.date)
    const cur = map.get(key) ?? { expense: 0, income: 0 }
    if (t.type === 'expense') cur.expense += t.amount
    if (t.type === 'income') cur.income += t.amount
    map.set(key, cur)
  }
  const out: DayPoint[] = []
  let cumulative = 0
  const d = new Date(range.from)
  const end = range.to.getTime()
  while (d.getTime() <= end && out.length < MAX_DAY_POINTS) {
    const key = dateKey(d)
    const v = map.get(key) ?? { expense: 0, income: 0 }
    cumulative += v.expense
    out.push({
      date: key,
      label: `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`,
      expense: v.expense, income: v.income, cumulative,
    })
    d.setDate(d.getDate() + 1)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Ряды для графиков
// ─────────────────────────────────────────────────────────────────────────────

export interface SeriesPoint {
  /**
   * Ключ точки: `YYYY-MM-DD` у дня, `YYYY-MM` у месяца. Операция принадлежит
   * точке, если её местная дата НАЧИНАЕТСЯ с ключа, — поэтому одна и та же
   * проверка (`inBucket`) раскрывает и день, и месяц.
   */
  key: string
  label: string
  expense: Minor
  income: Minor
  cumulative: Minor
}

export type SeriesStep = 'day' | 'month'

/** Длиннее этого периода столбик на день не разглядеть — группируем по месяцам. */
export const SERIES_DAY_LIMIT = 93

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** Подпись месяца по ключу `YYYY-MM`: «ноя», а для чужого года — «ноя 25». */
function monthLabel(key: string, withYear: boolean): string {
  const [y, m] = key.split('-')
  const name = MONTH_SHORT[Number(m) - 1] ?? key
  return withYear ? `${name} ${y.slice(2)}` : name
}

/**
 * Ряд для графика периода: по дням, а если период длиннее квартала — по месяцам.
 * Шкала непрерывная, пустые дни и месяцы остаются нулями: дырка в оси читается
 * как «тут ничего не тратили», а пропуск точки — как ошибка.
 */
export function timeSeries(txs: Transaction[], range: Range): { step: SeriesStep; points: SeriesPoint[] } {
  const days = byDay(txs, range)
  if (days.length <= SERIES_DAY_LIMIT) {
    return {
      step: 'day',
      points: days.map(d => ({ key: d.date, label: d.label, expense: d.expense, income: d.income, cumulative: d.cumulative })),
    }
  }
  const points: SeriesPoint[] = []
  const years = new Set(days.map(d => d.date.slice(0, 4)))
  for (const d of days) {
    const key = d.date.slice(0, 7)
    let p = points[points.length - 1]
    if (!p || p.key !== key) {
      p = { key, label: monthLabel(key, years.size > 1), expense: 0, income: 0, cumulative: 0 }
      points.push(p)
    }
    p.expense += d.expense
    p.income += d.income
    p.cumulative = d.cumulative           // накопленное на последний день месяца
  }
  return { step: 'month', points }
}

/** Принадлежит ли операция точке ряда (дню или месяцу) — по местной дате. */
export function inBucket(t: Transaction, key: string): boolean {
  return isoDateOnly(t.date).startsWith(key)
}

/**
 * Итоги по последним `months` месяцам, включая текущий, от старых к свежим.
 * `now` — параметр, чтобы расчёт не зависел от часов в тесте.
 */
export function monthlyTotals(allTxs: Transaction[], months: number, now: Date = new Date()): SeriesPoint[] {
  const points: SeriesPoint[] = []
  const index = new Map<string, SeriesPoint>()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = dateKey(d).slice(0, 7)
    const p: SeriesPoint = {
      key, label: monthLabel(key, d.getFullYear() !== now.getFullYear()),
      expense: 0, income: 0, cumulative: 0,
    }
    points.push(p)
    index.set(key, p)
  }
  for (const t of statsOnly(allTxs)) {
    const p = index.get(isoDateOnly(t.date).slice(0, 7))
    if (!p) continue
    if (t.type === 'expense') p.expense += t.amount
    if (t.type === 'income') p.income += t.amount
  }
  let cumulative = 0
  for (const p of points) { cumulative += p.expense; p.cumulative = cumulative }
  return points
}

/**
 * Самые крупные траты выборки, по убыванию. Те же правила, что у
 * `biggestExpense`: без переводов и операций вне статистики, тай-брейк по id.
 */
export function topExpenses(txs: Transaction[], limit: number): Transaction[] {
  return statsOnly(txs)
    .filter(t => t.type === 'expense')
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))
    .slice(0, limit)
}

export interface DayBlockCategory { categoryId: string; amount: Minor; count: number }

export interface DayBlock {
  /** YYYY-MM-DD */
  date: string
  expense: Minor
  income: Minor
  net: Minor
  count: number
  /** категории дня, по убыванию суммы */
  categories: DayBlockCategory[]
  /** доля расхода дня от самого дорогого дня периода: 0..1, для полоски */
  weight: number
  /** расход дня заметно выше среднего по периоду */
  heavy: boolean
}

/**
 * Разбор периода по дням: день — это блок с итогом и категориями внутри,
 * а не строка в плоском списке. Пустые дни не возвращаются: в перечне они
 * только шумят (для графика по дням есть `byDay`, там непрерывная шкала нужна).
 */
export function byDayBlocks(txs: Transaction[]): DayBlock[] {
  const map = new Map<string, { expense: number; income: number; count: number; cats: Map<string, { amount: number; count: number }> }>()

  for (const t of statsOnly(txs)) {
    if (t.type !== 'expense' && t.type !== 'income') continue
    // День — ЛОКАЛЬНЫЙ, как и в ленте операций (`groupByDay`). На срезе
    // ISO-строки ночная операция уезжала на сутки назад, и один и тот же
    // расход попадал в разные дни в «Истории» и в разрезе «Дни».
    const key = isoDateOnly(t.date)
    const day = map.get(key) ?? { expense: 0, income: 0, count: 0, cats: new Map() }
    day.count++
    if (t.type === 'income') {
      day.income += t.amount
    } else {
      day.expense += t.amount
      const c = day.cats.get(t.categoryId) ?? { amount: 0, count: 0 }
      c.amount += t.amount; c.count++
      day.cats.set(t.categoryId, c)
    }
    map.set(key, day)
  }

  const blocks = [...map.entries()].map(([date, d]) => ({
    date,
    expense: d.expense,
    income: d.income,
    net: d.income - d.expense,
    count: d.count,
    categories: [...d.cats.entries()]
      .map(([categoryId, c]) => ({ categoryId, amount: c.amount, count: c.count }))
      .sort((a, b) => b.amount - a.amount || a.categoryId.localeCompare(b.categoryId)),
    weight: 0,
    heavy: false,
  }))

  const maxExpense = blocks.reduce((m, b) => Math.max(m, b.expense), 0)
  const spending = blocks.filter(b => b.expense > 0)
  const avg = spending.length ? spending.reduce((s, b) => s + b.expense, 0) / spending.length : 0

  for (const b of blocks) {
    b.weight = maxExpense > 0 ? b.expense / maxExpense : 0
    // порог намеренно высокий: подсветка должна цеплять глаз редко, иначе
    // перестаёт что-либо значить
    b.heavy = avg > 0 && b.expense >= avg * 1.5
  }

  // свежие дни сверху
  return blocks.sort((a, b) => b.date.localeCompare(a.date))
}

export interface BudgetRow {
  budget: Budget
  spent: Minor
  pct: number
  /** где должны были быть по календарю: 0..1 */
  pace: number
  status: 'ok' | 'warn' | 'over'
}

export function budgetRows(budgets: Budget[], txs: Transaction[], range: Range): BudgetRow[] {
  const spentBy = new Map<string, number>()
  for (const t of statsOnly(txs)) {
    if (t.type !== 'expense') continue
    spentBy.set(t.categoryId, (spentBy.get(t.categoryId) ?? 0) + t.amount)
  }
  const pace = periodProgress(range)
  return budgets.map(b => {
    const spent = spentBy.get(b.categoryId) ?? 0
    const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0
    const status: BudgetRow['status'] =
      pct > 100 ? 'over' : pct > pace * 100 + 10 ? 'warn' : 'ok'
    return { budget: b, spent, pct, pace, status }
  }).sort((a, b) => b.pct - a.pct || a.budget.categoryId.localeCompare(b.budget.categoryId))
}

/** Прогноз расхода на конец периода по текущему темпу. */
export function forecastExpense(txs: Transaction[], range: Range): Minor | null {
  const p = periodProgress(range)
  if (p <= 0.05 || p >= 1) return null
  const { expense } = totals(txs)
  return Math.round(expense / p)
}

/**
 * Runway: на сколько месяцев хватит текущих ликвидных остатков
 * при среднемесячном расходе последних N месяцев.
 */
export function runwayMonths(liquid: Minor, monthlyBurn: Minor): number | null {
  if (monthlyBurn <= 0) return null
  return liquid / monthlyBurn
}

/** Среднемесячный расход за последние `months` месяцев. */
export function monthlyBurn(allTxs: Transaction[], months: number): Minor {
  // Считаем в днях, а не через setMonth: 31 мая минус 3 месяца давало 3 марта
  // (в феврале нет 31-го числа), и окно расчёта плыло на несколько дней.
  const since = new Date(Date.now() - months * 30.44 * 86_400_000)
  const sinceIso = since.toISOString()
  const spent = statsOnly(allTxs)
    .filter(t => t.type === 'expense' && t.date >= sinceIso)
    .reduce((s, t) => s + t.amount, 0)
  return Math.round(spent / months)
}

export interface Anomaly { categoryId: string; amount: Minor; baseline: Minor; deltaPct: number }

/**
 * Категории, где траты заметно выбились из нормы за предыдущие периоды.
 * Порог намеренно высокий (+50% и от 1000 ₽), чтобы не шуметь.
 */
export function anomalies(current: Transaction[], history: Transaction[][]): Anomaly[] {
  if (!history.length) return []
  const cur = new Map<string, number>()
  for (const t of statsOnly(current)) {
    if (t.type === 'expense') cur.set(t.categoryId, (cur.get(t.categoryId) ?? 0) + t.amount)
  }
  const base = new Map<string, number[]>()
  for (const period of history) {
    const m = new Map<string, number>()
    for (const t of statsOnly(period)) {
      if (t.type === 'expense') m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amount)
    }
    for (const [k, v] of m) base.set(k, [...(base.get(k) ?? []), v])
  }
  const out: Anomaly[] = []
  for (const [categoryId, amount] of cur) {
    const hist = base.get(categoryId)
    if (!hist || hist.length < 2) continue
    const avg = hist.reduce((s, v) => s + v, 0) / hist.length
    if (avg <= 0) continue
    const deltaPct = ((amount - avg) / avg) * 100
    if (deltaPct >= 50 && amount - avg >= 100_000) {
      out.push({ categoryId, amount, baseline: Math.round(avg), deltaPct })
    }
  }
  return out
    .sort((a, b) => b.deltaPct - a.deltaPct || a.categoryId.localeCompare(b.categoryId))
    .slice(0, 3)
}

/**
 * Подписки: один и тот же заголовок, близкая сумма, интервал 26–35 дней,
 * минимум три повтора.
 */
export interface Subscription { title: string; amount: Minor; categoryId: string; lastDate: string; count: number }

export function detectSubscriptions(allTxs: Transaction[]): Subscription[] {
  const groups = new Map<string, Transaction[]>()
  for (const t of statsOnly(allTxs)) {
    if (t.type !== 'expense') continue
    const key = `${t.title.trim().toLowerCase()}|${Math.round(t.amount / 1000)}`
    if (!key.startsWith('|')) groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const out: Subscription[] = []
  for (const list of groups.values()) {
    if (list.length < 3) continue
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86_400_000)
    }
    const avgGap = gaps.reduce((s, v) => s + v, 0) / gaps.length
    if (avgGap < 26 || avgGap > 35) continue
    const last = sorted[sorted.length - 1]
    out.push({
      title: last.title || 'Без названия',
      amount: Math.round(sorted.reduce((s, t) => s + t.amount, 0) / sorted.length),
      categoryId: last.categoryId,
      lastDate: last.date,
      count: sorted.length,
    })
  }
  return out
    .sort((a, b) => b.amount - a.amount || a.title.localeCompare(b.title))
    .slice(0, 8)
}
