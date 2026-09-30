import { useLiveQuery } from 'dexie-react-hooks'
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'
import { db } from '../../db'
import { DEFAULT_CATEGORIES } from '../../db/categories'
import { formatMoney, formatTime, getPeriodRange } from '../../utils/format'
import { useApp } from '../../store/AppContext'

export function HomeScreen() {
  const { setActiveTab } = useApp()

  const cards = useLiveQuery(() => db.cards.toArray(), [])
  const settings = useLiveQuery(() => db.settings.get(1), [])

  const { from, to } = getPeriodRange('month')
  const monthTx = useLiveQuery(
    () => db.transactions.where('date').between(from.toISOString(), to.toISOString(), true, true).toArray(),
    []
  )

  const recentTx = useLiveQuery(
    () => db.transactions.orderBy('date').reverse().limit(5).toArray(),
    []
  )

  const goals = useLiveQuery(
    () => db.goals.where('isArchived').equals(0).limit(2).toArray(),
    []
  )

  const totalBalance = cards?.reduce((s, c) => s + c.balance, 0) ?? 0
  const monthExpense = monthTx?.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) ?? 0
  const monthIncome = monthTx?.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0) ?? 0

  return (
    <div className="flex flex-col gap-5 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-secondary text-sm font-body">Привет, {settings?.userName ?? 'друг'} 👋</p>
          <h1 className="text-text-primary text-2xl font-display font-bold leading-tight">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h1>
        </div>
      </div>

      {/* Total balance card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-accent to-indigo-500 p-6">
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/5" />
        <div className="absolute -bottom-10 -left-4 w-32 h-32 rounded-full bg-white/5" />
        <p className="text-white/70 text-sm font-body mb-1">Общий баланс</p>
        <p className="text-white text-4xl font-display font-bold tracking-tight">
          {formatMoney(totalBalance)}
        </p>
        <div className="flex gap-6 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">
              <TrendingUp size={14} className="text-white" />
            </div>
            <div>
              <p className="text-white/60 text-[10px]">Доходы</p>
              <p className="text-white text-sm font-semibold">{formatMoney(monthIncome, true)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">
              <TrendingDown size={14} className="text-white" />
            </div>
            <div>
              <p className="text-white/60 text-[10px]">Расходы</p>
              <p className="text-white text-sm font-semibold">{formatMoney(monthExpense, true)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Cards */}
      <div>
        <p className="text-text-secondary text-xs font-body uppercase tracking-widest mb-3">Мои карты</p>
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
          {cards?.map(card => (
            <div
              key={card.id}
              className="flex-none w-52 rounded-2xl p-4 relative overflow-hidden"
              style={{ background: card.id === 'vtb' ? 'linear-gradient(135deg,#005CA9,#003f78)' : 'linear-gradient(135deg,#2a2a00,#3d3a00)' }}
            >
              <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-white/5" />
              <p className="text-white/70 text-xs font-body">{card.name}</p>
              <p className={`text-lg font-display font-bold mt-1 ${card.id === 'tbank' ? 'text-yellow-300' : 'text-white'}`}>
                {formatMoney(card.balance)}
              </p>
              <div className="flex items-center justify-between mt-3">
                <p className="text-white/40 text-xs">•••• {card.lastFour}</p>
                <button className="text-white/40 hover:text-white/70 transition-colors">
                  <RefreshCw size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent transactions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-text-secondary text-xs font-body uppercase tracking-widest">Последние операции</p>
          <button
            onClick={() => setActiveTab('transactions')}
            className="text-accent text-xs font-body font-medium"
          >
            Все →
          </button>
        </div>
        <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
          {!recentTx || recentTx.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-4xl mb-2">💸</p>
              <p className="text-text-secondary text-sm">Нет операций</p>
              <p className="text-text-muted text-xs mt-1">Нажмите + чтобы добавить</p>
            </div>
          ) : (
            recentTx.map((tx, i) => {
              const cat = DEFAULT_CATEGORIES.find(c => c.id === tx.categoryId)
              return (
                <div key={tx.id} className={`flex items-center gap-3 p-4 ${i < recentTx.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="w-10 h-10 rounded-xl bg-bg-card2 flex items-center justify-center text-lg flex-none">
                    {cat?.icon ?? '💳'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm font-body font-medium truncate">{tx.title || cat?.name}</p>
                    <p className="text-text-muted text-xs">{formatTime(tx.date)}</p>
                  </div>
                  <p className={`text-sm font-display font-semibold ${tx.type === 'income' ? 'text-accent-green' : 'text-accent-red'}`}>
                    {tx.type === 'income' ? '+' : '−'}{formatMoney(tx.amount, true)}
                  </p>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Goals preview */}
      {goals && goals.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-text-secondary text-xs font-body uppercase tracking-widest">Цели</p>
            <button onClick={() => setActiveTab('goals')} className="text-accent text-xs font-body font-medium">
              Все →
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {goals.map(goal => {
              const pct = Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100))
              return (
                <div key={goal.id} className="rounded-2xl bg-bg-card border border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{goal.icon}</span>
                      <p className="text-text-primary text-sm font-body font-medium">{goal.title}</p>
                    </div>
                    <p className="text-text-secondary text-xs">{pct}%</p>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-card2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent to-indigo-400 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-2">
                    <p className="text-accent text-xs font-mono">{formatMoney(goal.currentAmount, true)}</p>
                    <p className="text-text-muted text-xs font-mono">{formatMoney(goal.targetAmount, true)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
