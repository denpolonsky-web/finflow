import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, LineChart, Line, CartesianGrid, Legend,
} from 'recharts'
import { ChevronLeft, ChevronRight, Repeat } from 'lucide-react'
import { db } from '../../db'
import { categoryColor, categoryIcon, categoryName } from '../../db/categories'
import { formatMoney, formatDateShort } from '../../utils/format'
import { toMajor } from '../../utils/money'
import { getRange, periodProgress } from '../../utils/period'
import {
  totals, byCategory, byDay, budgetRows, forecastExpense, detectSubscriptions,
} from '../../utils/analytics'
import type { PeriodId } from '../../types'

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'year', label: 'Год' },
]

type View = 'overview' | 'categories' | 'budgets' | 'trends'

const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'categories', label: 'Категории' },
  { id: 'budgets', label: 'Бюджеты' },
  { id: 'trends', label: 'Тренды' },
]

const tooltipStyle = {
  background: '#1C1C2E', border: '1px solid #1E1E30',
  borderRadius: 12, color: '#F0F0FF', fontSize: 12,
}

export function StatsScreen() {
  const [period, setPeriod] = useState<PeriodId>('month')
  const [offset, setOffset] = useState(0)
  const [view, setView] = useState<View>('overview')

  const range = useMemo(() => getRange(period, offset), [period, offset])
  const prevRange = useMemo(() => getRange(period, offset - 1), [period, offset])

  const txs = useLiveQuery(
    () => db.transactions.where('date')
      .between(range.from.toISOString(), range.to.toISOString(), true, true).toArray(),
    [range.from.getTime(), range.to.getTime()], [],
  )
  const prevTxs = useLiveQuery(
    () => db.transactions.where('date')
      .between(prevRange.from.toISOString(), prevRange.to.toISOString(), true, true).toArray(),
    [prevRange.from.getTime(), prevRange.to.getTime()], [],
  )
  const allTxs = useLiveQuery(() => db.transactions.toArray(), [], [])
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [])

  const t = totals(txs)
  const prevT = totals(prevTxs)
  const cats = byCategory(txs, prevTxs)
  const days = byDay(txs, range)
  const bRows = budgetRows(budgets, txs, range)
  const forecast = forecastExpense(txs, range)
  const subs = useMemo(() => detectSubscriptions(allTxs), [allTxs])

  const monthlySeries = useMemo(() => {
    const out: { label: string; Расходы: number; Доходы: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const r = getRange('month', -i)
      const slice = allTxs.filter(x => x.date >= r.from.toISOString() && x.date <= r.to.toISOString())
      const m = totals(slice)
      out.push({
        label: r.from.toLocaleDateString('ru-RU', { month: 'short' }),
        Расходы: Math.round(toMajor(m.expense)),
        Доходы: Math.round(toMajor(m.income)),
      })
    }
    return out
  }, [allTxs])

  const deltaExpense = prevT.expense > 0
    ? ((t.expense - prevT.expense) / prevT.expense) * 100
    : null

  return (
    <div className="flex flex-col gap-4 pb-28">
      <h1 className="text-text-primary text-2xl font-bold">Аналитика</h1>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {PERIODS.map(p => (
          <button key={p.id} onClick={() => { setPeriod(p.id); setOffset(0) }}
            className={`flex-none px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              period === p.id ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary border border-border'}`}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between bg-bg-card border border-border rounded-2xl px-2 py-2">
        <button onClick={() => setOffset(o => o - 1)} aria-label="Предыдущий период"
          className="w-9 h-9 rounded-xl bg-bg-card2 flex items-center justify-center text-text-secondary">
          <ChevronLeft size={18} />
        </button>
        <p className="text-text-primary text-sm font-semibold">{range.label}</p>
        <button onClick={() => setOffset(o => Math.min(0, o + 1))} disabled={offset >= 0}
          aria-label="Следующий период"
          className="w-9 h-9 rounded-xl bg-bg-card2 flex items-center justify-center text-text-secondary disabled:opacity-30">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="flex bg-bg-card border border-border rounded-2xl p-1">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
              view === v.id ? 'bg-accent text-white' : 'text-text-secondary'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* ── ОБЗОР ── */}
      {view === 'overview' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Расходы', value: t.expense, color: 'text-accent-red' },
              { label: 'Доходы', value: t.income, color: 'text-accent-green' },
              { label: 'Итого', value: t.net, color: t.net >= 0 ? 'text-accent-green' : 'text-accent-red' },
            ].map(i => (
              <div key={i.label} className="bg-bg-card border border-border rounded-2xl p-3">
                <p className="text-text-muted text-[10px]">{i.label}</p>
                <p className={`text-sm font-bold mt-1 ${i.color}`}>{formatMoney(i.value, true)}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-bg-card border border-border rounded-2xl p-3">
              <p className="text-text-muted text-[10px]">Норма сбережений</p>
              <p className="text-text-primary text-lg font-bold mt-0.5">
                {t.savingsRate == null ? '—' : `${t.savingsRate.toFixed(0)}%`}
              </p>
            </div>
            <div className="bg-bg-card border border-border rounded-2xl p-3">
              <p className="text-text-muted text-[10px]">К прошлому периоду</p>
              <p className={`text-lg font-bold mt-0.5 ${
                deltaExpense == null ? 'text-text-muted' : deltaExpense > 0 ? 'text-accent-red' : 'text-accent-green'}`}>
                {deltaExpense == null ? '—' : `${deltaExpense > 0 ? '+' : ''}${deltaExpense.toFixed(0)}%`}
              </p>
            </div>
          </div>

          <div className="bg-bg-card border border-border rounded-2xl p-4">
            <p className="text-text-secondary text-xs uppercase tracking-widest mb-3">Структура расходов</p>
            <div className="flex gap-2 h-3 rounded-full overflow-hidden bg-bg-card2">
              <div style={{ width: `${t.expense ? (t.essential / t.expense) * 100 : 0}%` }} className="bg-accent" />
              <div style={{ width: `${t.expense ? (t.discretionary / t.expense) * 100 : 0}%` }} className="bg-accent-yellow" />
            </div>
            <div className="flex justify-between mt-3 text-xs">
              <span className="text-text-secondary">🔵 Обязательные {formatMoney(t.essential, true)}</span>
              <span className="text-text-secondary">🟡 Остальное {formatMoney(t.discretionary, true)}</span>
            </div>
          </div>

          {forecast != null && (
            <div className="bg-accent/10 border border-accent/20 rounded-2xl p-4">
              <p className="text-text-muted text-xs mb-1">Прогноз на конец периода</p>
              <p className="text-text-primary text-xl font-bold">{formatMoney(forecast)}</p>
              <p className="text-text-muted text-xs mt-1">
                Прошло {(periodProgress(range) * 100).toFixed(0)}% периода, потрачено {formatMoney(t.expense, true)}
              </p>
            </div>
          )}

          {days.length > 1 && (
            <div className="bg-bg-card border border-border rounded-2xl p-4">
              <p className="text-text-secondary text-xs uppercase tracking-widest mb-4">Расходы по дням</p>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={days.map(d => ({ name: d.label, value: toMajor(d.expense) }))} barSize={6}>
                  <XAxis dataKey="name" tick={{ fill: '#8080A8', fontSize: 9 }} axisLine={false} tickLine={false}
                    interval={Math.max(0, Math.floor(days.length / 8))} />
                  <Tooltip contentStyle={tooltipStyle}
                    formatter={(v: unknown) => [formatMoney(Math.round(Number(v) * 100), true), 'Расходы']} />
                  <Bar dataKey="value" fill="#6C63FF" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {/* ── КАТЕГОРИИ ── */}
      {view === 'categories' && (
        cats.length === 0 ? (
          <Empty />
        ) : (
          <>
            <div className="bg-bg-card border border-border rounded-2xl p-4">
              <div className="flex gap-4 items-center">
                <ResponsiveContainer width={130} height={130}>
                  <PieChart>
                    <Pie data={cats.slice(0, 7)} dataKey="amount" innerRadius={40} outerRadius={62}
                      paddingAngle={3} startAngle={90} endAngle={-270}>
                      {cats.slice(0, 7).map(c => (
                        <Cell key={c.categoryId} fill={categoryColor(c.categoryId)} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle}
                      formatter={(v: unknown, _n, p: { payload?: { categoryId?: string } }) =>
                        [formatMoney(Number(v), true), categoryName(p?.payload?.categoryId ?? '')]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1.5 flex-1">
                  {cats.slice(0, 7).map(c => (
                    <div key={c.categoryId} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-none" style={{ background: categoryColor(c.categoryId) }} />
                      <span className="text-xs text-text-secondary flex-1 truncate">{categoryName(c.categoryId)}</span>
                      <span className="text-xs text-text-primary">{c.share.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-bg-card border border-border rounded-2xl p-4">
              <p className="text-text-secondary text-xs uppercase tracking-widest mb-4">
                Детализация и динамика
              </p>
              <div className="flex flex-col gap-3.5">
                {cats.map(c => (
                  <div key={c.categoryId}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-text-primary text-sm">
                        {categoryIcon(c.categoryId)} {categoryName(c.categoryId)}
                        <span className="text-text-muted text-xs ml-1.5">×{c.count}</span>
                      </p>
                      <div className="flex items-center gap-2">
                        {c.delta != null && Math.abs(c.delta) >= 5 && (
                          <span className={`text-[10px] font-semibold ${c.delta > 0 ? 'text-accent-red' : 'text-accent-green'}`}>
                            {c.delta > 0 ? '+' : ''}{c.delta.toFixed(0)}%
                          </span>
                        )}
                        <span className="text-text-secondary text-xs">{formatMoney(c.amount, true)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-bg-card2 overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${c.share}%`, background: categoryColor(c.categoryId) }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )
      )}

      {/* ── БЮДЖЕТЫ ── */}
      {view === 'budgets' && (
        bRows.length === 0 ? (
          <div className="text-center py-14">
            <p className="text-4xl mb-2">🎯</p>
            <p className="text-text-secondary text-sm">Бюджеты не заданы</p>
            <p className="text-text-muted text-xs mt-1">Настройки → Бюджеты по категориям</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {bRows.map(r => (
              <div key={r.budget.id} className="bg-bg-card border border-border rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-text-primary text-sm font-medium">
                    {categoryIcon(r.budget.categoryId)} {categoryName(r.budget.categoryId)}
                  </p>
                  <p className={`text-xs font-semibold ${
                    r.status === 'over' ? 'text-accent-red' : r.status === 'warn' ? 'text-accent-yellow' : 'text-accent-green'}`}>
                    {r.pct.toFixed(0)}%
                  </p>
                </div>
                <div className="relative h-2 rounded-full bg-bg-card2 overflow-hidden">
                  <div className={`h-full rounded-full ${
                    r.status === 'over' ? 'bg-accent-red' : r.status === 'warn' ? 'bg-accent-yellow' : 'bg-accent-green'}`}
                    style={{ width: `${Math.min(100, r.pct)}%` }} />
                  {/* метка «где мы должны быть по календарю» */}
                  <div className="absolute top-0 bottom-0 w-0.5 bg-text-primary/50"
                    style={{ left: `${r.pace * 100}%` }} />
                </div>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="text-text-secondary">{formatMoney(r.spent, true)} из {formatMoney(r.budget.amount, true)}</span>
                  <span className={r.budget.amount - r.spent >= 0 ? 'text-text-muted' : 'text-accent-red'}>
                    {r.budget.amount - r.spent >= 0
                      ? `осталось ${formatMoney(r.budget.amount - r.spent, true)}`
                      : `перерасход ${formatMoney(r.spent - r.budget.amount, true)}`}
                  </span>
                </div>
                {r.status === 'warn' && (
                  <p className="text-accent-yellow text-[11px] mt-2">
                    Темп выше календарного: прошло {(r.pace * 100).toFixed(0)}% периода
                  </p>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── ТРЕНДЫ ── */}
      {view === 'trends' && (
        <>
          <div className="bg-bg-card border border-border rounded-2xl p-4">
            <p className="text-text-secondary text-xs uppercase tracking-widest mb-4">
              Доходы и расходы, 6 месяцев
            </p>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={monthlySeries} margin={{ left: -18, right: 6 }}>
                <CartesianGrid stroke="#1E1E30" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#8080A8', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8080A8', fontSize: 9 }} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}к` : String(v))} />
                <Tooltip contentStyle={tooltipStyle}
                  formatter={(v: unknown, name: unknown) => [formatMoney(Math.round(Number(v) * 100), true), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#8080A8' }} />
                <Line type="monotone" dataKey="Расходы" stroke="#FF5C7A" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="Доходы" stroke="#00C896" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-bg-card border border-border rounded-2xl p-4">
            <p className="text-text-secondary text-xs uppercase tracking-widest mb-4">
              Накопительный расход за период
            </p>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={days.map(d => ({ name: d.label, value: toMajor(d.cumulative) }))} margin={{ left: -18, right: 6 }}>
                <CartesianGrid stroke="#1E1E30" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#8080A8', fontSize: 9 }} axisLine={false} tickLine={false}
                  interval={Math.max(0, Math.floor(days.length / 8))} />
                <YAxis tick={{ fill: '#8080A8', fontSize: 9 }} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}к` : String(v))} />
                <Tooltip contentStyle={tooltipStyle}
                  formatter={(v: unknown) => [formatMoney(Math.round(Number(v) * 100), true), 'Накопленно']} />
                <Line type="monotone" dataKey="value" stroke="#6C63FF" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {subs.length > 0 && (
            <div className="bg-bg-card border border-border rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Repeat size={14} className="text-accent" />
                <p className="text-text-secondary text-xs uppercase tracking-widest">Похоже на подписки</p>
              </div>
              <div className="flex flex-col gap-2.5">
                {subs.map(s => (
                  <div key={s.title} className="flex items-center gap-3">
                    <span className="text-lg">{categoryIcon(s.categoryId)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-sm truncate">{s.title}</p>
                      <p className="text-text-muted text-[11px]">
                        {s.count} списаний, последнее {formatDateShort(s.lastDate)}
                      </p>
                    </div>
                    <p className="text-text-secondary text-sm font-semibold">{formatMoney(s.amount, true)}</p>
                  </div>
                ))}
              </div>
              <p className="text-text-muted text-[11px] mt-3">
                Итого в месяц: {formatMoney(subs.reduce((s, x) => s + x.amount, 0))}
              </p>
            </div>
          )}
        </>
      )}

      {txs.length === 0 && view !== 'budgets' && <Empty />}
    </div>
  )
}

function Empty() {
  return (
    <div className="text-center py-16">
      <p className="text-4xl mb-2">📊</p>
      <p className="text-text-secondary">Нет данных за период</p>
    </div>
  )
}
