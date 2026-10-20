import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  ChevronLeft, ChevronRight, Download, FileSpreadsheet, SlidersHorizontal,
  Save, Trash2, RotateCcw,
} from 'lucide-react'
import { db } from '../../db'
import { DEFAULT_CATEGORIES } from '../../db/categories'
import { download } from '../../db/exportData'
import { useAccounts } from '../../hooks/useBalances'
import { useProfile } from '../../store/ProfileContext'
import { useApp } from '../../store/AppContext'
import { formatMoney } from '../../utils/format'
import { toMajor, toMinor } from '../../utils/money'
import { getRange } from '../../utils/period'
import {
  applyFilters, buildReport, reportTotal, reportToCsv, rawToCsv, isMoneyMetric,
  METRICS, GROUPS, CHARTS, EMPTY_FILTERS,
  type ChartKind, type GroupBy, type Metric, type ReportFilters,
} from '../../utils/report'
import type { PeriodId, Transaction, TransactionType } from '../../types'

const PRESET_KEY = 'finflow.reportPresets'

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'year', label: 'Год' },
  { id: 'custom', label: 'Период' },
]

interface SavedPreset {
  name: string
  metric: Metric
  groupBy: GroupBy
  chart: ChartKind
  period: PeriodId
  filters: ReportFilters
  compare: boolean
}

function loadPresets(): SavedPreset[] {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]') as SavedPreset[] } catch { return [] }
}
function savePresets(list: SavedPreset[]) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)) } catch { /* приватный режим */ }
}

const chip = (on: boolean) =>
  `flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
    on ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary border border-border'}`

const tooltipStyle = {
  background: '#1C1C2E', border: '1px solid #1E1E30',
  borderRadius: 12, color: '#F0F0FF', fontSize: 12,
}

export function AnalyticsScreen() {
  const { showToast } = useApp()
  const { profiles, canSeeAll, profile, scope } = useProfile()
  const accountList = useAccounts(true)
  const accounts = useMemo(() => accountList ?? [], [accountList])

  const [period, setPeriod] = useState<PeriodId>('month')
  const [offset, setOffset] = useState(0)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const [metric, setMetric] = useState<Metric>('expense')
  const [groupBy, setGroupBy] = useState<GroupBy>('category')
  const [chart, setChart] = useState<ChartKind>('bar')
  const [compare, setCompare] = useState(false)
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [presets, setPresets] = useState<SavedPreset[]>(loadPresets)

  const range = useMemo(
    () => getRange(period, offset, customFrom || undefined, customTo || undefined),
    [period, offset, customFrom, customTo],
  )
  const prevRange = useMemo(() => getRange(period, offset - 1), [period, offset])

  const rawTxs = useLiveQuery(
    () => db.transactions.where('date')
      .between(range.from.toISOString(), range.to.toISOString(), true, true).toArray(),
    [range.from.getTime(), range.to.getTime()], [],
  )
  const rawPrev = useLiveQuery(
    async (): Promise<Transaction[]> => (compare
      ? db.transactions.where('date')
        .between(prevRange.from.toISOString(), prevRange.to.toISOString(), true, true).toArray()
      : []),
    [prevRange.from.getTime(), prevRange.to.getTime(), compare],
    [] as Transaction[],
  )

  const maps = useMemo(() => ({ accounts, profiles }), [accounts, profiles])

  // вторая роль видит только свои операции — фильтр по видимости идёт ПЕРВЫМ,
  // до любых пользовательских фильтров, чтобы его нельзя было обойти настройкой
  const selection = useMemo(() => applyFilters(scope(rawTxs), filters), [rawTxs, filters, scope])
  const prevSelection = useMemo(() => applyFilters(scope(rawPrev), filters), [rawPrev, filters, scope])

  const rows = useMemo(
    () => buildReport(selection, groupBy, metric, maps, prevSelection),
    [selection, groupBy, metric, maps, prevSelection],
  )
  const total = reportTotal(rows, metric)
  const money = isMoneyMetric(metric)
  const fmt = (v: number) => (money ? formatMoney(v, true) : String(v))

  const chartData = useMemo(
    () => rows.slice(0, chart === 'pie' ? 8 : 60)
      .map(r => ({ name: r.label, value: money ? toMajor(r.value) : r.value, fill: r.color })),
    [rows, chart, money],
  )

  const title = `${METRICS.find(m => m.id === metric)?.label} · ${GROUPS.find(g => g.id === groupBy)?.label} · ${range.label}`
  const stamp = new Date().toISOString().slice(0, 10)

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter(x => x !== v) : [...list, v]
  }

  function addPreset() {
    const name = prompt('Название отчёта', title)
    if (!name) return
    const next = [...presets, { name, metric, groupBy, chart, period, filters, compare }]
    setPresets(next); savePresets(next)
    showToast('Отчёт сохранён')
  }

  function applyPreset(p: SavedPreset) {
    setMetric(p.metric); setGroupBy(p.groupBy); setChart(p.chart)
    setPeriod(p.period); setFilters(p.filters); setCompare(p.compare); setOffset(0)
  }

  function dropPreset(i: number) {
    const next = presets.filter((_, idx) => idx !== i)
    setPresets(next); savePresets(next)
  }

  const activeFilterCount =
    filters.types.length + filters.accountIds.length + filters.categoryIds.length
    + filters.profileIds.length + (filters.search ? 1 : 0)
    + (filters.includeExcluded ? 1 : 0)
    + (filters.minAmount != null ? 1 : 0) + (filters.maxAmount != null ? 1 : 0)

  return (
    <div className="flex flex-col gap-4">
      {/* ── Период ─────────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {PERIODS.map(p => (
          <button key={p.id} onClick={() => { setPeriod(p.id); setOffset(0) }} className={chip(period === p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {period === 'custom' ? (
        <div className="flex items-center gap-2 bg-bg-card border border-border rounded-2xl p-2">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            className="flex-1 bg-bg-card2 rounded-xl px-3 py-2 text-text-primary text-xs outline-none" />
          <span className="text-text-muted text-xs">—</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
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

      {/* ── Конфиг отчёта ───────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 bg-bg-card border border-border rounded-2xl p-3">
        <div>
          <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Показатель</p>
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            {METRICS.map(m => (
              <button key={m.id} onClick={() => setMetric(m.id)} className={chip(metric === m.id)}>{m.label}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Разрез</p>
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            {GROUPS.filter(g => g.id !== 'profile' || canSeeAll).map(g => (
              <button key={g.id} onClick={() => setGroupBy(g.id)} className={chip(groupBy === g.id)}>{g.label}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Вид</p>
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            {CHARTS.map(c => (
              <button key={c.id} onClick={() => setChart(c.id)} className={chip(chart === c.id)}>{c.label}</button>
            ))}
            <button onClick={() => setCompare(c => !c)} className={chip(compare)}>± к прошлому</button>
            <button onClick={() => setShowFilters(s => !s)} className={chip(showFilters || activeFilterCount > 0)}>
              <span className="flex items-center gap-1">
                <SlidersHorizontal size={11} />
                Фильтры{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Фильтры ─────────────────────────────────────────────── */}
      {showFilters && (
        <div className="flex flex-col gap-3 bg-bg-card border border-border rounded-2xl p-3">
          <input value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="Поиск по названию, комментарию, категории"
            className="w-full bg-bg-card2 rounded-xl px-3 py-2 text-text-primary text-xs outline-none placeholder:text-text-muted" />

          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Тип операции</p>
            <div className="flex gap-2 flex-wrap">
              {(['expense', 'income', 'transfer'] as TransactionType[]).map(t => (
                <button key={t} onClick={() => setFilters(f => ({ ...f, types: toggle(f.types, t) }))}
                  className={chip(filters.types.includes(t))}>
                  {t === 'expense' ? 'Расход' : t === 'income' ? 'Доход' : 'Перевод'}
                </button>
              ))}
              <button onClick={() => setFilters(f => ({ ...f, includeExcluded: !f.includeExcluded }))}
                className={chip(filters.includeExcluded)}>
                + переводы и корректировки
              </button>
            </div>
          </div>

          {accounts.length > 0 && (
            <div>
              <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Счета</p>
              <div className="flex gap-2 flex-wrap">
                {accounts.map(a => (
                  <button key={a.id} onClick={() => setFilters(f => ({ ...f, accountIds: toggle(f.accountIds, a.id) }))}
                    className={chip(filters.accountIds.includes(a.id))}>{a.name}</button>
                ))}
              </div>
            </div>
          )}

          {canSeeAll && profiles.length > 1 && (
            <div>
              <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Профили</p>
              <div className="flex gap-2 flex-wrap">
                {profiles.map(p => (
                  <button key={p.id} onClick={() => setFilters(f => ({ ...f, profileIds: toggle(f.profileIds, p.id) }))}
                    className={chip(filters.profileIds.includes(p.id))}>{p.emoji} {p.name}</button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Категории</p>
            <div className="flex gap-2 flex-wrap max-h-32 overflow-y-auto">
              {DEFAULT_CATEGORIES.filter(c => c.type !== 'both').map(c => (
                <button key={c.id} onClick={() => setFilters(f => ({ ...f, categoryIds: toggle(f.categoryIds, c.id) }))}
                  className={chip(filters.categoryIds.includes(c.id))}>{c.icon} {c.name}</button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input inputMode="decimal" placeholder="Сумма от"
              defaultValue={filters.minAmount != null ? String(toMajor(filters.minAmount)) : ''}
              onBlur={e => setFilters(f => ({ ...f, minAmount: e.target.value ? toMinor(e.target.value) : null }))}
              className="flex-1 bg-bg-card2 rounded-xl px-3 py-2 text-text-primary text-xs outline-none" />
            <input inputMode="decimal" placeholder="до"
              defaultValue={filters.maxAmount != null ? String(toMajor(filters.maxAmount)) : ''}
              onBlur={e => setFilters(f => ({ ...f, maxAmount: e.target.value ? toMinor(e.target.value) : null }))}
              className="flex-1 bg-bg-card2 rounded-xl px-3 py-2 text-text-primary text-xs outline-none" />
            <button onClick={() => setFilters(EMPTY_FILTERS)} aria-label="Сбросить фильтры"
              className="w-9 h-9 rounded-xl bg-bg-card2 flex items-center justify-center text-text-secondary">
              <RotateCcw size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Итог ────────────────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-2xl p-4">
        <p className="text-text-muted text-xs">{METRICS.find(m => m.id === metric)?.label} · {range.label}</p>
        <p className={`text-3xl font-bold mt-1 ${
          metric === 'net' ? (total >= 0 ? 'text-accent-green' : 'text-accent-red') : 'text-text-primary'}`}>
          {money ? formatMoney(total) : total}
        </p>
        <p className="text-text-muted text-xs mt-1">
          {selection.length} операц. в выборке{!canSeeAll && profile ? ` · профиль «${profile.name}»` : ''}
        </p>
      </div>

      {/* ── График ──────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="text-center py-14 bg-bg-card border border-border rounded-2xl">
          <p className="text-4xl mb-2">📊</p>
          <p className="text-text-secondary text-sm">Нет данных под эти условия</p>
        </div>
      ) : chart !== 'table' && (
        <div className="bg-bg-card border border-border rounded-2xl p-3">
          <ResponsiveContainer width="100%" height={chart === 'pie' ? 230 : 210}>
            {chart === 'bar' ? (
              <BarChart data={chartData} margin={{ left: -16, right: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E1E30" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#8080A8', fontSize: 9 }} axisLine={false} tickLine={false}
                  interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#8080A8', fontSize: 9 }} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#ffffff08' }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            ) : chart === 'line' ? (
              <LineChart data={chartData} margin={{ left: -16, right: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E1E30" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#8080A8', fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8080A8', fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="value" stroke="#6C63FF" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            ) : chart === 'area' ? (
              <AreaChart data={chartData} margin={{ left: -16, right: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E1E30" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#8080A8', fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8080A8', fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="value" stroke="#6C63FF" fill="#6C63FF33" strokeWidth={2} />
              </AreaChart>
            ) : (
              <PieChart>
                <Pie data={chartData} dataKey="value" innerRadius={48} outerRadius={78} paddingAngle={2}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Таблица ─────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
          {rows.map((r, i) => (
            <div key={r.key}
              className={`flex items-center gap-3 px-4 py-3 ${i < rows.length - 1 ? 'border-b border-border' : ''}`}>
              <span className="w-2 h-7 rounded-full flex-none" style={{ background: r.color }} />
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm font-medium truncate">{r.label}</p>
                <p className="text-text-muted text-xs">
                  {r.share.toFixed(1)}% · {r.count} опер.
                  {r.delta != null && (
                    <span className={r.delta > 0 ? ' text-accent-red' : ' text-accent-green'}>
                      {' '}{r.delta > 0 ? '+' : ''}{r.delta.toFixed(0)}%
                    </span>
                  )}
                </p>
              </div>
              <p className="text-text-primary text-sm font-semibold flex-none">{fmt(r.value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Выгрузка и пресеты ──────────────────────────────────── */}
      <div className="flex gap-2">
        <button
          onClick={() => download(`finflow-отчёт-${stamp}.csv`, reportToCsv(rows, groupBy, metric, title), 'text/csv')}
          className="flex-1 h-11 rounded-xl bg-bg-card border border-border text-text-primary text-xs font-semibold flex items-center justify-center gap-1.5">
          <Download size={14} /> Таблица CSV
        </button>
        <button
          onClick={() => download(`finflow-операции-${stamp}.csv`, rawToCsv(selection, maps, title), 'text/csv')}
          className="flex-1 h-11 rounded-xl bg-bg-card border border-border text-text-primary text-xs font-semibold flex items-center justify-center gap-1.5">
          <FileSpreadsheet size={14} /> Операции CSV
        </button>
        <button onClick={addPreset} aria-label="Сохранить отчёт"
          className="w-11 h-11 rounded-xl bg-accent/15 border border-accent/30 text-accent flex items-center justify-center flex-none">
          <Save size={15} />
        </button>
      </div>

      {presets.length > 0 && (
        <div>
          <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Сохранённые отчёты</p>
          <div className="flex flex-col gap-1.5">
            {presets.map((p, i) => (
              <div key={i} className="flex items-center gap-2 bg-bg-card border border-border rounded-xl px-3 py-2">
                <button onClick={() => applyPreset(p)} className="flex-1 text-left text-text-primary text-xs truncate">
                  {p.name}
                </button>
                <button onClick={() => dropPreset(i)} aria-label="Удалить отчёт" className="text-text-muted flex-none">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
