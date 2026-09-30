import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from 'recharts'
import { db } from '../../db'
import { DEFAULT_CATEGORIES } from '../../db/categories'
import { formatMoney, formatDateShort, getPeriodRange } from '../../utils/format'
import type { Period } from '../../types'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'year', label: 'Год' },
]

export function StatsScreen() {
  const [period, setPeriod] = useState<Period>('month')

  const { from, to } = getPeriodRange(period)
  const transactions = useLiveQuery(
    () => db.transactions.where('date').between(from.toISOString(), to.toISOString(), true, true).toArray(),
    [period]
  )

  const expenses = transactions?.filter(t => t.type === 'expense') ?? []
  const incomes = transactions?.filter(t => t.type === 'income') ?? []
  const totalExpense = expenses.reduce((s, t) => s + t.amount, 0)
  const totalIncome = incomes.reduce((s, t) => s + t.amount, 0)

  // By category
  const byCat = expenses.reduce<Record<string, number>>((acc, t) => {
    acc[t.categoryId] = (acc[t.categoryId] ?? 0) + t.amount
    return acc
  }, {})
  const catData = Object.entries(byCat)
    .map(([id, amount]) => ({
      id, amount,
      cat: DEFAULT_CATEGORIES.find(c => c.id === id),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6)

  // By day (bar chart)
  const dayMap: Record<string, number> = {}
  expenses.forEach(t => {
    const day = formatDateShort(t.date)
    dayMap[day] = (dayMap[day] ?? 0) + t.amount
  })
  const barData = Object.entries(dayMap).map(([name, value]) => ({ name, value }))

  const COLORS = ['#6C63FF','#00C896','#FF5C7A','#FFB800','#00BCD4','#E91E63']

  return (
    <div className="flex flex-col gap-5 pb-24">
      <h1 className="text-text-primary text-2xl font-display font-bold">Статистика</h1>

      {/* Period */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {PERIODS.map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`flex-none px-4 py-2 rounded-xl text-sm font-body font-medium transition-all ${
              period === p.id ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary border border-border'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Расходы', value: totalExpense, color: 'text-accent-red' },
          { label: 'Доходы', value: totalIncome, color: 'text-accent-green' },
          { label: 'Итого', value: totalIncome - totalExpense, color: totalIncome - totalExpense >= 0 ? 'text-accent-green' : 'text-accent-red' },
        ].map(item => (
          <div key={item.label} className="bg-bg-card border border-border rounded-2xl p-3">
            <p className="text-text-muted text-[10px]">{item.label}</p>
            <p className={`text-sm font-display font-bold mt-1 ${item.color}`}>{formatMoney(item.value, true)}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      {barData.length > 0 && (
        <div className="bg-bg-card border border-border rounded-2xl p-4">
          <p className="text-text-secondary text-xs uppercase tracking-widest mb-4">Расходы по дням</p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={barData} barSize={8}>
              <XAxis dataKey="name" tick={{ fill: '#8080A8', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#1C1C2E', border: '1px solid #1E1E30', borderRadius: 12, color: '#F0F0FF', fontSize: 12 }}
                formatter={(v: unknown) => [formatMoney(Number(v), true), 'Расходы']}
              />
              <Bar dataKey="value" fill="#6C63FF" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Pie + legend */}
      {catData.length > 0 && (
        <div className="bg-bg-card border border-border rounded-2xl p-4">
          <p className="text-text-secondary text-xs uppercase tracking-widest mb-4">По категориям</p>
          <div className="flex gap-4 items-center">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={catData} dataKey="amount" innerRadius={42} outerRadius={66} paddingAngle={3} startAngle={90} endAngle={-270}>
                  {catData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2 flex-1">
              {catData.map((item, i) => (
                <div key={item.id} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-none" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-xs text-text-secondary flex-1 truncate">{item.cat?.icon} {item.cat?.name}</span>
                  <span className="text-xs font-mono text-text-primary">{formatMoney(item.amount, true)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Category bars */}
      {catData.length > 0 && (
        <div className="bg-bg-card border border-border rounded-2xl p-4">
          <p className="text-text-secondary text-xs uppercase tracking-widest mb-4">Детализация</p>
          <div className="flex flex-col gap-3">
            {catData.map((item, i) => {
              const pct = totalExpense > 0 ? Math.round((item.amount / totalExpense) * 100) : 0
              return (
                <div key={item.id}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-text-primary text-sm">{item.cat?.icon} {item.cat?.name}</p>
                    <p className="text-text-secondary text-xs font-mono">{formatMoney(item.amount, true)}</p>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-card2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {transactions?.length === 0 && (
        <div className="text-center py-16">
          <p className="text-4xl mb-2">📊</p>
          <p className="text-text-secondary">Нет данных за период</p>
        </div>
      )}
    </div>
  )
}
