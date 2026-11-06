import { getCategory } from '../db/categories'
import type { Budget, Minor, Range, Transaction } from '../types'
import { periodProgress } from './period'

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

export interface DayPoint { date: string; label: string; expense: Minor; income: Minor; cumulative: Minor }

/**
 * Предохранитель от бесконечного цикла на битом диапазоне — два года с запасом.
 * Прежний предел в 400 точек молча обрезал произвольный период длиннее ~13 месяцев.
 */
const MAX_DAY_POINTS = 740

export function byDay(txs: Transaction[], range: Range): DayPoint[] {
  const map = new Map<string, { expense: number; income: number }>()
  for (const t of statsOnly(txs)) {
    const key = t.date.slice(0, 10)
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
    const key = d.toISOString().slice(0, 10)
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
    const key = t.date.slice(0, 10)
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
