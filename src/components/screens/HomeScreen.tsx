import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { TrendingUp, TrendingDown, Settings, AlertTriangle } from 'lucide-react'
import { db } from '../../db'
import { categoryName } from '../../db/categories'
import { formatMoney, monthName, plural } from '../../utils/format'
import { getRange } from '../../utils/period'
import { totals, monthlyBurn, runwayMonths, anomalies, biggestExpense, byCategory } from '../../utils/analytics'
import { useApp } from '../../store/AppContext'
import { useAccounts, useBalances, liquidTotal, netWorth } from '../../hooks/useBalances'
import { bankPreset, availableCredit } from '../../db/accounts'
import { buildPlan } from '../../db/goals'
import { useProfile } from '../../store/ProfileContext'
import { ScopePicker } from '../ui/ScopePicker'
import { TxList } from '../ui/TxList'
import { CategoryIcon } from '../ui/CategoryIcon'
import { loadAmountColors, loadWidgetPrefs, scopeLabel } from '../../utils/uiPrefs'

export function HomeScreen() {
  const { setActiveTab, setEditTx } = useApp()
  const { canSeeAll, profile, scope, viewScope, profiles } = useProfile()
  const widgets = useMemo(() => loadWidgetPrefs(), [])
  const colors = useMemo(() => loadAmountColors(), [])
  const accounts = useAccounts()
  const balances = useBalances()
  const settings = useLiveQuery(() => db.settings.get(1), [])

  const month = getRange('month', 0)
  /** Настоящее название месяца: «Расходы за ноябрь», а не «за месяц». */
  const monthLabel = monthName(month.from)

  const rawMonthTx = useLiveQuery(
    () => db.transactions.where('date')
      .between(month.from.toISOString(), month.to.toISOString(), true, true).toArray(),
    [month.from.getTime()],
    [],
  )
  const rawAllTx = useLiveQuery(() => db.transactions.toArray(), [], [])

  /**
   * «Последние операции» уважают разрез. Срез делаем ПОСЛЕ фильтра по профилю:
   * иначе limit(5) по кабинету мог не захватить ни одной операции выбранного
   * профиля — блок становился пустым, хотя у профиля операции есть.
   *
   * Разрез `'mine'` для админа и ограниченная роль — одно и то же обращение
   * к индексу `profileId`, разрез по id другого профиля — тоже; `'all'` или
   * нет профиля — последние 5 по всему кабинету.
   */
  const scopedProfileId = !canSeeAll ? profile?.id
    : viewScope === 'mine' ? profile?.id
      : viewScope !== 'all' ? viewScope
        : null
  /**
   * Без значения по умолчанию: с `[]` первый кадр неотличим от пустой базы,
   * и при каждом открытии главной мелькало «Нет операций» — у человека
   * с полной историей. `undefined` — это «ещё читаем».
   */
  const rawRecent = useLiveQuery(
    async () => {
      if (scopedProfileId) {
        const own = await db.transactions.where('profileId').equals(scopedProfileId).sortBy('date')
        return own.slice(-5).reverse()
      }
      return db.transactions.orderBy('date').reverse().limit(5).toArray()
    },
    [scopedProfileId],
  )
  const recentLoading = rawRecent === undefined

  const monthTx = useMemo(() => scope(rawMonthTx), [rawMonthTx, scope])
  const allTx = useMemo(() => scope(rawAllTx), [rawAllTx, scope])
  const recent = useMemo(() => scope(rawRecent ?? []).slice(0, 5), [rawRecent, scope])
  const goals = useLiveQuery(
    () => db.goals.toArray().then(l => l.filter(g => !g.isArchived).slice(0, 2)),
    [], [],
  )

  const list = accounts ?? []
  const net = netWorth(list, balances)
  const liquid = liquidTotal(list, balances)
  const t = totals(monthTx)
  const burn = monthlyBurn(allTx, settings?.runwayWindowMonths ?? 3)
  const runway = runwayMonths(liquid, burn)
  const history = useMemo(() => {
    const out: typeof allTx[] = []
    for (let i = 1; i <= 3; i++) {
      const r = getRange('month', -i)
      const from = r.from.toISOString(), to = r.to.toISOString()
      out.push(allTx.filter(x => x.date >= from && x.date <= to))
    }
    return out
  }, [allTx])
  const alerts = anomalies(monthTx, history)

  /**
   * Факты месяца: что именно съело деньги. Считаются из уже загруженных
   * операций месяца, лишних запросов нет. Оба блока молчат, когда расходов
   * за месяц ещё не было, — показывать «—» тут незачем.
   */
  const topExpense = useMemo(() => biggestExpense(monthTx), [monthTx])
  const topCategory = useMemo(() => byCategory(monthTx)[0] ?? null, [monthTx])
  const showTopExpense = widgets.topExpense && topExpense
  const showTopCategory = widgets.topCategory && topCategory

  return (
    <div className="flex flex-col gap-5 pb-28">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-text-secondary text-sm">Привет, {settings?.userName || 'друг'} 👋</p>
          <h1 className="text-text-primary text-2xl font-bold leading-tight">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h1>
        </div>
        <button onClick={() => setActiveTab('settings')} aria-label="Настройки"
          className="w-9 h-9 rounded-full bg-bg-card border border-border flex items-center justify-center text-text-secondary">
          <Settings size={17} />
        </button>
      </div>

      {/* Общий итог. Вторая роль баланс кабинета не видит — только свои траты. */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-accent to-indigo-500 p-6">
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/5" />
        <div className="absolute -bottom-10 -left-4 w-32 h-32 rounded-full bg-white/5" />
        <p className="text-white/70 text-sm mb-1">
          {canSeeAll ? 'Всего на счетах' : `Мои расходы за ${monthLabel} · ${profile?.name ?? ''}`}
        </p>
        <p className="text-white text-4xl font-bold tracking-tight">
          {canSeeAll ? formatMoney(net) : formatMoney(t.expense)}
        </p>
        {canSeeAll && liquid !== net && (
          <p className="text-white/60 text-xs mt-1">Доступно сейчас: {formatMoney(liquid)}</p>
        )}
        {canSeeAll && viewScope !== 'all' && (
          <p className="text-white/60 text-[11px] mt-1">
            Операции за {monthLabel}: {scopeLabel(viewScope, profiles, profile?.name)}.
            Остаток на счетах общий.
          </p>
        )}
        <div className="flex gap-6 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">
              <TrendingUp size={14} className="text-white" />
            </div>
            <div>
              <p className="text-white/60 text-[10px]">Доходы за {monthLabel}</p>
              <p className="text-white text-sm font-semibold">{formatMoney(t.income, true)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">
              <TrendingDown size={14} className="text-white" />
            </div>
            <div>
              <p className="text-white/60 text-[10px]">Расходы за {monthLabel}</p>
              <p className="text-white text-sm font-semibold">{formatMoney(t.expense, true)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Разрез: вместе с работником или раздельно */}
      <ScopePicker />

      {/* Факты месяца. Нажатие ведёт туда, где можно разобраться:
          на саму операцию и в разрез по категориям. */}
      {(showTopExpense || showTopCategory) && (
        <div className="flex gap-2">
          {showTopExpense && topExpense && (
            <button onClick={() => setEditTx(topExpense.tx)}
              className="flex-1 text-left bg-bg-card border border-border rounded-2xl p-3 active:scale-[0.98] transition-transform">
              {/* min-h на две строки: у длинного заголовка он переносится,
                  у короткого нет — без этого суммы в двух плитках не на одной линии */}
              <p className="text-text-muted text-[10px] leading-tight min-h-[2.4em]">
                Крупнейшая трата за {monthLabel}
              </p>
              <p className="text-lg font-bold mt-0.5" style={{ color: colors.expense }}>
                {formatMoney(topExpense.tx.amount, true)}
              </p>
              <p className="text-text-secondary text-[11px] mt-0.5 flex items-center gap-1 min-w-0">
                <CategoryIcon id={topExpense.tx.categoryId} size={14} />
                <span className="truncate">
                  {topExpense.tx.title || categoryName(topExpense.tx.categoryId)}
                </span>
              </p>
              <p className="text-text-muted text-[10px] mt-0.5">
                {topExpense.share.toFixed(0)}% расходов месяца
              </p>
            </button>
          )}
          {showTopCategory && topCategory && (
            <button onClick={() => setActiveTab('stats')}
              className="flex-1 text-left bg-bg-card border border-border rounded-2xl p-3 active:scale-[0.98] transition-transform">
              <p className="text-text-muted text-[10px] leading-tight min-h-[2.4em]">
                Топ-категория за {monthLabel}
              </p>
              <p className="text-lg font-bold mt-0.5" style={{ color: colors.expense }}>
                {formatMoney(topCategory.amount, true)}
              </p>
              <p className="text-text-secondary text-[11px] mt-0.5 flex items-center gap-1 min-w-0">
                <CategoryIcon id={topCategory.categoryId} size={14} />
                <span className="truncate">{categoryName(topCategory.categoryId)}</span>
              </p>
              <p className="text-text-muted text-[10px] mt-0.5">
                {topCategory.share.toFixed(0)}% расходов · {topCategory.count}{' '}
                {plural(topCategory.count, 'операция', 'операции', 'операций')}
              </p>
            </button>
          )}
        </div>
      )}

      {/* Запас прочности — завязан на общий баланс кабинета.
          «Норма сбережений» отсюда убрана совсем: доля дохода мало что говорила
          сама по себе и в первый же месяц без дохода показывала прочерк. */}
      {canSeeAll && widgets.runway && (
        <div className="bg-bg-card border border-border rounded-2xl p-3">
          <p className="text-text-muted text-[10px]">Запас прочности</p>
          <p className={`text-lg font-bold mt-0.5 ${
            (runway ?? 0) >= 6 ? 'text-accent-green' : (runway ?? 0) >= 3 ? 'text-accent-yellow' : 'text-accent-red'}`}>
            {runway == null ? '—' : `${runway.toFixed(1)} мес`}
          </p>
          <p className="text-text-muted text-[10px] mt-0.5">
            при {formatMoney(burn, true)}/мес
          </p>
        </div>
      )}

      {widgets.anomalies && alerts.length > 0 && (
        <div className="bg-accent-yellow/10 border border-accent-yellow/20 rounded-2xl p-4 flex gap-3">
          <AlertTriangle size={18} className="text-accent-yellow flex-none mt-0.5" />
          <div className="flex flex-col gap-1">
            {alerts.map(a => (
              <p key={a.categoryId} className="text-text-secondary text-xs">
                <span className="text-text-primary font-medium">{categoryName(a.categoryId)}</span>
                {' '}+{a.deltaPct.toFixed(0)}% к прошлому месяцу ({formatMoney(a.amount, true)} против {formatMoney(a.baseline, true)})
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Счета с остатками — только главной роли */}
      {canSeeAll && (
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-text-secondary text-xs uppercase tracking-widest">Счета</p>
          <button onClick={() => setActiveTab('accounts')} className="text-accent text-xs font-medium">Все →</button>
        </div>
        {list.length === 0 ? (
          <button onClick={() => setActiveTab('accounts')}
            className="w-full rounded-2xl bg-bg-card border border-dashed border-border p-6 text-center">
            <p className="text-text-secondary text-sm">Счетов пока нет</p>
            <p className="text-accent text-xs mt-1">Добавить первый →</p>
          </button>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
            {list.map(a => {
              const bal = balances.get(a.id) ?? 0
              const avail = availableCredit(a, bal)
              return (
                <div key={a.id} onClick={() => setActiveTab('accounts')}
                  className={`flex-none w-48 rounded-2xl p-4 relative overflow-hidden bg-gradient-to-br ${bankPreset(a.bank).gradient} cursor-pointer`}>
                  <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-white/5" />
                  <p className="text-white/70 text-xs truncate">{a.name}</p>
                  <p className="text-white text-lg font-bold mt-1">{formatMoney(bal)}</p>
                  <p className="text-white/40 text-[10px] mt-2">
                    {avail != null ? `Доступно ${formatMoney(avail, true)}` : a.lastFour ? `•••• ${a.lastFour}` : '\u00A0'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      {/* Последние операции */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-text-secondary text-xs uppercase tracking-widest">Последние операции</p>
          <button onClick={() => setActiveTab('transactions')} className="text-accent text-xs font-medium">Все →</button>
        </div>
        {/* Тот же список, что и в «Истории»: с датами и разбивкой по дням.
            Раньше здесь шла сплошная лента без единой даты.

            Итог дня здесь НЕ показываем: в блоке только пять последних
            операций, и итог посчитался бы по ним, а не по всему дню —
            рядом с «Сегодня» стояла бы сумма, которой у дня нет.
            Полные итоги по дням — в «Истории». */}
        {recentLoading ? (
          <div className="rounded-2xl bg-bg-card border border-border p-8 text-center">
            <p className="text-text-muted text-xs">Загружаем…</p>
          </div>
        ) : recent.length === 0 ? (
          <div className="rounded-2xl bg-bg-card border border-border p-8 text-center">
            <p className="text-4xl mb-2">💸</p>
            <p className="text-text-secondary text-sm">Нет операций</p>
            <p className="text-text-muted text-xs mt-1">Нажмите + чтобы добавить</p>
          </div>
        ) : (
          <TxList items={recent} onPick={setEditTx} colors={colors} showDayTotal={false}
            accounts={list} />
        )}
      </div>

      {/* Цели */}
      {canSeeAll && goals.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-text-secondary text-xs uppercase tracking-widest">Цели</p>
            <button onClick={() => setActiveTab('goals')} className="text-accent text-xs font-medium">Все →</button>
          </div>
          <div className="flex flex-col gap-2">
            {goals.map(g => {
              const current = g.fundingAccountId ? (balances.get(g.fundingAccountId) ?? 0) : g.manualAmount
              const plan = buildPlan(g, current)
              return (
                <button key={g.id} onClick={() => setActiveTab('goals')}
                  className="w-full text-left rounded-2xl bg-bg-card border border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{g.icon}</span>
                      <p className="text-text-primary text-sm font-medium">{g.title}</p>
                    </div>
                    <p className="text-text-secondary text-xs">{plan.pct}%</p>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-card2 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-accent to-indigo-400 transition-all"
                      style={{ width: `${plan.pct}%` }} />
                  </div>
                  <div className="flex justify-between mt-2">
                    <p className="text-accent text-xs">{formatMoney(plan.current, true)}</p>
                    <p className="text-text-muted text-xs">
                      {plan.daysLeft != null && plan.daysLeft > 0
                        ? `${plan.daysLeft} ${plural(plan.daysLeft, 'день', 'дня', 'дней')}`
                        : formatMoney(plan.target, true)}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
