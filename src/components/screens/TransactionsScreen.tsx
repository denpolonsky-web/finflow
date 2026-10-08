import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import { db } from '../../db'
import { categoryIcon, categoryName } from '../../db/categories'
import { formatMoney, formatDate, formatTime } from '../../utils/format'
import { getRange } from '../../utils/period'
import { totals } from '../../utils/analytics'
import { useApp } from '../../store/AppContext'
import { useAccounts } from '../../hooks/useBalances'
import type { PeriodId, Transaction } from '../../types'

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'year', label: 'Год' },
]

type Filter = 'all' | 'expense' | 'income' | 'transfer'

export function TransactionsScreen() {
  const { setEditTx } = useApp()
  const [period, setPeriod] = useState<PeriodId>('month')
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [accountFilter, setAccountFilter] = useState<string>('')

  const accounts = useAccounts(true)
  const range = useMemo(() => getRange(period, offset), [period, offset])

  const transactions = useLiveQuery(
    () => db.transactions.where('date')
      .between(range.from.toISOString(), range.to.toISOString(), true, true)
      .reverse().sortBy('date'),
    [range.from.getTime(), range.to.getTime()],
    [],
  )

  const filtered = useMemo(() => transactions.filter(tx => {
    const q = search.trim().toLowerCase()
    const matchSearch = !q
      || tx.title.toLowerCase().includes(q)
      || categoryName(tx.categoryId).toLowerCase().includes(q)
      || (tx.comment ?? '').toLowerCase().includes(q)
    const matchType = filter === 'all' || tx.type === filter
    const matchAccount = !accountFilter || tx.accountId === accountFilter || tx.toAccountId === accountFilter
    return matchSearch && matchType && matchAccount
  }), [transactions, search, filter, accountFilter])

  const grouped = useMemo(() => {
    const acc: Record<string, Transaction[]> = {}
    for (const tx of filtered) {
      const day = formatDate(tx.date)
      ;(acc[day] ??= []).push(tx)
    }
    return Object.entries(acc)
  }, [filtered])

  const t = totals(filtered)

  return (
    <div className="flex flex-col gap-4 pb-28">
      <h1 className="text-text-primary text-2xl font-bold">Операции</h1>

      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию, категории, комментарию"
          className="w-full bg-bg-card border border-border rounded-2xl pl-10 pr-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {PERIODS.map(p => (
          <button key={p.id} onClick={() => { setPeriod(p.id); setOffset(0) }}
            className={`flex-none px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              period === p.id ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary border border-border'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Навигация по периодам — раньше прошлые месяцы были недоступны вовсе */}
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

      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {([['all', 'Все'], ['expense', '↓ Расходы'], ['income', '↑ Доходы'], ['transfer', '⇄ Переводы']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === id ? 'bg-bg-card2 text-text-primary border border-accent' : 'bg-bg-card text-text-muted border border-border'}`}>
            {label}
          </button>
        ))}
        {(accounts?.length ?? 0) > 1 && (
          <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)}
            className="flex-none bg-bg-card text-text-muted border border-border rounded-lg text-xs px-2 py-1.5 outline-none">
            <option value="">Все счета</option>
            {accounts?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1 bg-bg-card border border-border rounded-2xl p-3">
          <p className="text-text-muted text-xs">Расходы</p>
          <p className="text-accent-red text-base font-bold mt-0.5">{formatMoney(t.expense, true)}</p>
        </div>
        <div className="flex-1 bg-bg-card border border-border rounded-2xl p-3">
          <p className="text-text-muted text-xs">Доходы</p>
          <p className="text-accent-green text-base font-bold mt-0.5">{formatMoney(t.income, true)}</p>
        </div>
        <div className="flex-1 bg-bg-card border border-border rounded-2xl p-3">
          <p className="text-text-muted text-xs">Итого</p>
          <p className={`text-base font-bold mt-0.5 ${t.net >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {formatMoney(t.net, true)}
          </p>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-2">🔍</p>
          <p className="text-text-secondary">Нет операций за период</p>
        </div>
      ) : grouped.map(([day, txs]) => {
        const dayTotal = txs.reduce((s, t2) =>
          t2.excludeFromStats ? s : t2.type === 'expense' ? s - t2.amount : t2.type === 'income' ? s + t2.amount : s, 0)
        return (
          <div key={day}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-text-secondary text-xs uppercase tracking-widest">{day}</p>
              <p className={`text-xs font-semibold ${dayTotal >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {dayTotal >= 0 ? '+' : '−'}{formatMoney(Math.abs(dayTotal), true)}
              </p>
            </div>
            <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
              {txs.map((tx, i) => (
                <button key={tx.id} onClick={() => setEditTx(tx)}
                  className={`w-full text-left flex items-center gap-3 p-4 active:bg-bg-card2 ${
                    i < txs.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="w-10 h-10 rounded-xl bg-bg-card2 flex items-center justify-center text-lg flex-none">
                    {categoryIcon(tx.categoryId)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm font-medium truncate">
                      {tx.title || categoryName(tx.categoryId)}
                    </p>
                    <p className="text-text-muted text-xs truncate">
                      {categoryName(tx.categoryId)} · {formatTime(tx.date)}
                    </p>
                  </div>
                  <p className={`text-sm font-semibold ${
                    tx.type === 'income' ? 'text-accent-green' : tx.type === 'transfer' ? 'text-text-secondary' : 'text-accent-red'}`}>
                    {tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}{formatMoney(tx.amount, true)}
                  </p>
                  <Pencil size={13} className="text-text-muted flex-none" />
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
