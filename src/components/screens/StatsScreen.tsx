import { useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Pencil, SlidersHorizontal, Check } from 'lucide-react'
import { db } from '../../db'
import { useProfile } from '../../store/ProfileContext'
import { useAccounts } from '../../hooks/useBalances'
import { ScopePicker } from '../ui/ScopePicker'
import { FiltersPanel } from '../ui/FiltersPanel'
import { PickList } from '../ui/PickList'
import { TxDrillSheet } from '../ui/TxDrillSheet'
import { Loading } from '../stats/Card'
import { OverviewView } from '../stats/OverviewView'
import { DaysView } from '../stats/DaysView'
import { BreakdownView } from '../stats/BreakdownView'
import { TrendsView } from '../stats/TrendsView'
import { TopView } from '../stats/TopView'
import { BudgetsView } from '../stats/BudgetsView'
import { ReportsView } from '../stats/ReportsView'
import type { Drill, ViewCtx } from '../stats/types'
import { comparableCutoff, getRange } from '../../utils/period'
import {
  applyFilters, countActiveFilters, describeFilters, EMPTY_FILTERS, type ReportFilters,
} from '../../utils/report'
import {
  loadAmountColors, loadChartModes, loadPeriods, loadStatsViews, loadWidgetPrefs,
  saveChartModes, savePeriods, saveStatsViews,
  PERIOD_OPTIONS, STATS_VIEWS,
  type ChartModes, type PeriodPref, type StatsViewId,
} from '../../utils/uiPrefs'
import type { PeriodId } from '../../types'

/**
 * Аналитика. Разделы и периоды человек выбирает сам (карандаш в шапке):
 * лишние скрываются, нужные включаются — раньше набор был жёстким, и половина
 * вкладок была не нужна, а нужного в них не было.
 *
 * Экран отвечает за выборку (период, роль, условия) и drill-down; сами разделы
 * живут в `components/stats/*` и получают готовый `ViewCtx`.
 */
export function StatsScreen() {
  const { scope, canSeeAll, profiles } = useProfile()

  const [views, setViews] = useState<StatsViewId[]>(loadStatsViews)
  const [periods, setPeriods] = useState<PeriodPref[]>(loadPeriods)
  const [modes, setModes] = useState<ChartModes>(loadChartModes)
  const [editing, setEditing] = useState(false)

  const [view, setView] = useState<StatsViewId>(() => loadStatsViews()[0])
  const [period, setPeriod] = useState<PeriodId>(() => (loadPeriods().includes('month') ? 'month' : loadPeriods()[0]))
  const [offset, setOffset] = useState(0)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [drillInfo, setDrill] = useState<Drill | null>(null)

  const accountList = useAccounts(true)
  const maps = useMemo(() => ({ accounts: accountList ?? [], profiles }), [accountList, profiles])
  const activeFilters = countActiveFilters(filters)
  const colors = useMemo(() => loadAmountColors(), [])
  const widgets = useMemo(() => loadWidgetPrefs(), [])

  /** Раздел мог быть выключен в карандаше, пока был открыт — тогда берём первый. */
  const activeView = views.includes(view) ? view : views[0]

  const range = useMemo(
    () => getRange(period, offset, customFrom || undefined, customTo || undefined),
    [period, offset, customFrom, customTo],
  )
  const prevRange = useMemo(() => getRange(period, offset - 1), [period, offset])

  /**
   * Без значения по умолчанию: с `[]` первый кадр неотличим от пустого
   * периода, и при каждом открытии аналитики мелькало «Нет данных за период».
   */
  const rawTxs = useLiveQuery(
    () => db.transactions.where('date')
      .between(range.from.toISOString(), range.to.toISOString(), true, true).toArray(),
    [range.from.getTime(), range.to.getTime()],
  )
  const rawPrevTxs = useLiveQuery(
    () => db.transactions.where('date')
      .between(prevRange.from.toISOString(), prevRange.to.toISOString(), true, true).toArray(),
    [prevRange.from.getTime(), prevRange.to.getTime()], [],
  )
  const rawAllTxs = useLiveQuery(() => db.transactions.toArray(), [])
  const loading = rawTxs === undefined || rawAllTxs === undefined

  /**
   * Порядок обязателен: сначала видимость по роли (`scope`), потом условия
   * пользователя (`applyFilters`). Иначе фильтр стал бы способом увидеть
   * чужие операции.
   */
  const txs = useMemo(() => applyFilters(scope(rawTxs ?? []), filters), [rawTxs, scope, filters])
  /**
   * Прошлый период обрезаем по той же точке, до которой дошёл текущий.
   * Иначе 7 ноября «К прошлому периоду» сопоставляло неделю с целым октябрём
   * и показывало −81%: цифра читается как «стал тратить втрое меньше»,
   * а означает «месяц ещё не кончился».
   */
  const prevCutoff = useMemo(() => comparableCutoff(range, prevRange), [range, prevRange])
  const prevTxs = useMemo(() => {
    const list = applyFilters(scope(rawPrevTxs), filters)
    return prevCutoff ? list.filter(t => t.date <= prevCutoff) : list
  }, [rawPrevTxs, scope, filters, prevCutoff])
  const allTxs = useMemo(() => applyFilters(scope(rawAllTxs ?? []), filters), [rawAllTxs, scope, filters])

  const setMode = useCallback(<K extends keyof ChartModes>(key: K, value: ChartModes[K]) => {
    setModes(prev => { const next = { ...prev, [key]: value }; saveChartModes(next); return next })
  }, [])

  const ctx: ViewCtx = {
    txs, prevTxs, allTxs, range, prevCutoff, colors, widgets, modes, setMode, maps,
    drill: setDrill,
    hasView: v => views.includes(v),
    goTo: v => { if (views.includes(v)) setView(v) },
  }

  /** Операции под открытым шитом считаются из живого запроса, а не из снимка. */
  const drillTxs = useMemo(() => {
    if (!drillInfo) return []
    return (drillInfo.source === 'all' ? allTxs : txs).filter(drillInfo.match)
  }, [drillInfo, txs, allTxs])

  function changePeriod(p: PeriodPref) {
    setPeriod(p)
    setOffset(0)
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-text-primary text-2xl font-bold">Аналитика</h1>
        <button onClick={() => setEditing(e => !e)}
          aria-label={editing ? 'Готово' : 'Настроить разделы'}
          className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 flex-none ${
            editing ? 'bg-accent text-white' : 'bg-bg-card border border-border text-text-secondary'}`}>
          {editing ? <><Check size={14} /> Готово</> : <><Pencil size={14} /> Разделы</>}
        </button>
      </div>

      {editing && (
        <div className="flex flex-col gap-4 bg-bg-card border border-border rounded-2xl p-4">
          <div>
            <p className="text-text-secondary text-xs uppercase tracking-widest mb-1">Разделы аналитики</p>
            <p className="text-text-secondary/70 text-[11px] mb-2.5">
              Галочка включает раздел, стрелки задают порядок вкладок.
            </p>
            <PickList items={STATS_VIEWS} value={views} reorder
              onChange={next => { setViews(next); saveStatsViews(next) }} />
          </div>
          <div>
            <p className="text-text-secondary text-xs uppercase tracking-widest mb-1">Периоды</p>
            <p className="text-text-secondary/70 text-[11px] mb-2.5">
              Какие кнопки периода показывать. Порядок всегда от короткого к длинному.
            </p>
            <PickList items={PERIOD_OPTIONS} value={periods}
              onChange={next => { setPeriods(next); savePeriods(next) }} />
          </div>
          <p className="text-text-secondary/70 text-[11px]">
            Нижнюю панель и блоки-подсказки настраивают в Настройках. Всё хранится
            на этом устройстве и в облако не уезжает.
          </p>
        </div>
      )}

      {/* ── Разделы ── */}
      <div className="flex bg-bg-card border border-border rounded-2xl p-1 overflow-x-auto scrollbar-none">
        {views.map(id => (
          <button key={id} onClick={() => setView(id)}
            className={`flex-1 min-w-[76px] py-2 px-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeView === id ? 'bg-accent text-white' : 'text-text-secondary'}`}>
            {STATS_VIEWS.find(v => v.id === id)?.label}
          </button>
        ))}
      </div>

      <ScopePicker />

      {/* ── Период ── */}
      <div className="flex flex-wrap justify-center gap-2">
        {periods.map(p => (
          <button key={p} onClick={() => changePeriod(p)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              period === p ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary border border-border'}`}>
            {PERIOD_OPTIONS.find(o => o.id === p)?.label}
          </button>
        ))}
      </div>

      {period === 'custom' ? (
        <div className="flex items-center gap-2 bg-bg-card border border-border rounded-2xl p-2">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            aria-label="Дата от"
            className="flex-1 bg-bg-card2 rounded-xl px-3 py-2 text-text-primary text-xs outline-none" />
          <span className="text-text-secondary text-xs">—</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
            aria-label="Дата до"
            className="flex-1 bg-bg-card2 rounded-xl px-3 py-2 text-text-primary text-xs outline-none" />
        </div>
      ) : (
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
      )}

      {/* ── Условия выборки: действуют на ВСЕ разделы ── */}
      <div className="flex items-center gap-2">
        <button onClick={() => setShowFilters(s => !s)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeFilters > 0 ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary border border-border'}`}>
          <SlidersHorizontal size={12} />
          Условия{activeFilters > 0 ? ` (${activeFilters})` : ''}
        </button>
        {activeFilters > 0 && (
          <button onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-text-secondary text-xs underline flex-none">
            сбросить
          </button>
        )}
      </div>

      {showFilters && (
        <FiltersPanel filters={filters} onChange={setFilters} maps={maps} showProfiles={canSeeAll} />
      )}

      {/* Видно, почему цифры меньше общих: без подписи сужённая выборка
          выглядит как ошибка в расчётах */}
      {activeFilters > 0 && (
        <p className="text-text-secondary text-[11px] -mt-1">
          Выборка сужена: {describeFilters(filters, maps).join(' · ')}. Операций: {txs.length}
        </p>
      )}

      {loading ? <Loading /> : (
        <>
          {activeView === 'overview' && <OverviewView {...ctx} />}
          {activeView === 'days' && <DaysView {...ctx} />}
          {activeView === 'categories' && (
            <BreakdownView {...ctx} groupBy="category" metric="expense" totalLabel="Все расходы" icons />
          )}
          {activeView === 'income' && (
            <BreakdownView {...ctx} groupBy="category" metric="income" totalLabel="Все доходы" icons />
          )}
          {activeView === 'accounts' && (
            <BreakdownView {...ctx} groupBy="account" metric="expense" totalLabel="Расходы по счетам" />
          )}
          {activeView === 'weekdays' && (
            <BreakdownView {...ctx} groupBy="weekday" metric="expense" totalLabel="Расходы по дням недели" forceBars />
          )}
          {activeView === 'trends' && <TrendsView {...ctx} />}
          {activeView === 'top' && <TopView {...ctx} />}
          {activeView === 'budgets' && <BudgetsView {...ctx} />}
          {activeView === 'builder' && <ReportsView {...ctx} />}
        </>
      )}

      {drillInfo && (
        <TxDrillSheet
          title={drillInfo.title}
          subtitle={drillInfo.subtitle}
          txs={drillTxs}
          colors={colors}
          accounts={maps.accounts}
          onClose={() => setDrill(null)}
          action={drillInfo.categoryId
            ? {
              label: 'Оставить в выборке только эту категорию',
              run: () => {
                setFilters(f => ({ ...f, categoryIds: [drillInfo.categoryId!] }))
                setDrill(null)
              },
            }
            : undefined}
        />
      )}
    </div>
  )
}
