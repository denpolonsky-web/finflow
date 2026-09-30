import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Trash2, Pencil } from 'lucide-react'
import { db } from '../../db'
import { deleteTransaction } from '../../db/transactions'
import { DEFAULT_CATEGORIES } from '../../db/categories'
import { formatMoney, formatDate, formatTime, getPeriodRange } from '../../utils/format'
import type { Period, Transaction } from '../../types'
import { EditTransactionSheet } from './EditTransactionSheet'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'year', label: 'Год' },
]

export function TransactionsScreen() {
  const [period, setPeriod] = useState<Period>('month')
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'expense' | 'income'>('all')
  const [editTx, setEditTx] = useState<Transaction | null>(null)

  const { from, to } = getPeriodRange(period)

  const transactions = useLiveQuery(
    () => db.transactions
      .where('date')
      .between(from.toISOString(), to.toISOString(), true, true)
      .reverse()
      .sortBy('date'),
    [period]
  )

  const filtered = transactions?.filter(tx => {
    const matchSearch = !search || tx.title.toLowerCase().includes(search.toLowerCase())
    const matchType = filterType === 'all' || tx.type === filterType
    return matchSearch && matchType
  }) ?? []

  // Group by day
  const grouped = filtered.reduce<Record<string, Transaction[]>>((acc, tx) => {
    const day = formatDate(tx.date)
    if (!acc[day]) acc[day] = []
    acc[day].push(tx)
    return acc
  }, {})

  const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const totalIncome = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)

  return (
    <div className="flex flex-col gap-4 pb-24">
      <h1 className="text-text-primary text-2xl font-display font-bold">Операции</h1>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Поиск по операциям..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-bg-card border border-border rounded-2xl pl-10 pr-4 py-3 text-text-primary text-sm font-body placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

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

      {/* Type filter */}
      <div className="flex gap-2">
        {(['all','expense','income'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilterType(f)}
            className={`flex-none px-3 py-1.5 rounded-lg text-xs font-body font-semibold transition-all ${
              filterType === f ? 'bg-bg-card2 text-text-primary border border-accent' : 'bg-bg-card text-text-muted border border-border'
            }`}
          >
            {f === 'all' ? 'Все' : f === 'expense' ? '↓ Расходы' : '↑ Доходы'}
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className="flex gap-3">
        <div className="flex-1 bg-bg-card border border-border rounded-2xl p-3">
          <p className="text-text-muted text-xs">Расходы</p>
          <p className="text-accent-red text-base font-display font-bold mt-0.5">{formatMoney(totalExpense, true)}</p>
        </div>
        <div className="flex-1 bg-bg-card border border-border rounded-2xl p-3">
          <p className="text-text-muted text-xs">Доходы</p>
          <p className="text-accent-green text-base font-display font-bold mt-0.5">{formatMoney(totalIncome, true)}</p>
        </div>
      </div>

      {/* Grouped list */}
      {Object.entries(grouped).length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-2">🔍</p>
          <p className="text-text-secondary">Нет операций за период</p>
        </div>
      ) : (
        Object.entries(grouped).map(([day, txs]) => {
          const dayTotal = txs.reduce((s, t) => t.type === 'expense' ? s - t.amount : s + t.amount, 0)
          return (
            <div key={day}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-text-secondary text-xs font-body uppercase tracking-widest">{day}</p>
                <p className={`text-xs font-mono font-semibold ${dayTotal >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {dayTotal >= 0 ? '+' : ''}{formatMoney(dayTotal, true)}
                </p>
              </div>
              <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
                {txs.map((tx, i) => {
                  const cat = DEFAULT_CATEGORIES.find(c => c.id === tx.categoryId)
                  return (
                    <div
                      key={tx.id}
                      className={`flex items-center gap-3 p-4 ${i < txs.length - 1 ? 'border-b border-border' : ''}`}
                    >
                      <div className="w-10 h-10 rounded-xl bg-bg-card2 flex items-center justify-center text-lg flex-none">
                        {cat?.icon ?? '💳'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary text-sm font-body font-medium truncate">{tx.title}</p>
                        <p className="text-text-muted text-xs">{cat?.name} · {formatTime(tx.date)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-display font-semibold ${tx.type === 'income' ? 'text-accent-green' : 'text-accent-red'}`}>
                          {tx.type === 'income' ? '+' : '−'}{formatMoney(tx.amount, true)}
                        </p>
                        <button onClick={() => setEditTx(tx)} className="text-text-muted hover:text-accent transition-colors p-1">
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteTransaction(tx.id)}
                          className="text-text-muted hover:text-accent-red transition-colors p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    <EditTransactionSheet tx={editTx} onClose={() => setEditTx(null)} />
    </div>
  )
}
