import { useMemo, useState } from 'react'
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Download, Save, Trash2, Pencil, Check } from 'lucide-react'
import { download } from '../../db/exportData'
import { ChartTooltip } from '../ui/ChartTooltip'
import { Card, Empty } from './Card'
import { AXIS_TICK, CURSOR_FILL, shortMoney, type ViewCtx } from './types'
import { formatMoney } from '../../utils/format'
import { toMajor } from '../../utils/money'
import { useApp } from '../../store/AppContext'
import {
  buildReport, keyOf, rawToCsv, reportToCsv, reportTotal, isMoneyMetric,
  GROUPS, GROUP_PHRASE, METRICS, type GroupBy, type Metric,
} from '../../utils/report'

/**
 * Отчёты. Прежний «Конструктор» был тремя рядами безымянных фишек —
 * показатель, разрез, вид графика, — и что получится, становилось понятно
 * только после нажатия.
 *
 * Здесь то же самое сказано одной фразой: «Расходы по категориям». Готовые
 * отчёты отвечают на частые вопросы сразу, а «свой» собирается в той же фразе,
 * словами. Вид графика не выбирается вовсе: круговая для долей, полосы для
 * остального — выбор тут ничего не решал.
 */

interface Ready {
  id: string
  title: string
  question: string
  metric: Metric
  groupBy: GroupBy
}

/** Готовые отчёты названы вопросами, на которые они отвечают. */
const READY: Ready[] = [
  { id: 'cat', title: 'Расходы по категориям', question: 'На что уходят деньги?', metric: 'expense', groupBy: 'category' },
  { id: 'inc', title: 'Доходы по источникам', question: 'Откуда приходят деньги?', metric: 'income', groupBy: 'category' },
  { id: 'acc', title: 'Расходы по счетам', question: 'С какой карты платим чаще?', metric: 'expense', groupBy: 'account' },
  { id: 'wd', title: 'Расходы по дням недели', question: 'В какие дни тратим больше?', metric: 'expense', groupBy: 'weekday' },
  { id: 'mon', title: 'Чистый поток по месяцам', question: 'В плюсе или в минусе?', metric: 'net', groupBy: 'month' },
  { id: 'avg', title: 'Средний чек по категориям', question: 'Где покупки самые дорогие?', metric: 'avg', groupBy: 'category' },
  { id: 'cnt', title: 'Число операций по категориям', question: 'Что покупаем чаще всего?', metric: 'count', groupBy: 'category' },
  { id: 'prof', title: 'Расходы по профилям', question: 'Кто сколько потратил?', metric: 'expense', groupBy: 'profile' },
]

const PRESET_KEY = 'finflow.reportPresets2'

interface SavedPreset { name: string; metric: Metric; groupBy: GroupBy }

function loadPresets(): SavedPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]') as SavedPreset[]
    // пресет мог быть записан прошлой версией — берём только то, что понимаем
    return raw.filter(p => METRICS.some(m => m.id === p.metric) && GROUPS.some(g => g.id === p.groupBy))
  } catch { return [] }
}

function savePresets(list: SavedPreset[]) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)) } catch { /* приватный режим */ }
}

export function ReportsView(ctx: ViewCtx) {
  const { txs, prevTxs, maps, range, colors, drill } = ctx
  const { showToast } = useApp()
  const canSeeProfiles = maps.profiles.length > 1

  const [metric, setMetric] = useState<Metric>('expense')
  const [groupBy, setGroupBy] = useState<GroupBy>('category')
  const [editing, setEditing] = useState(false)
  const [presets, setPresets] = useState<SavedPreset[]>(loadPresets)

  const rows = useMemo(
    () => buildReport(txs, groupBy, metric, maps, prevTxs),
    [txs, groupBy, metric, maps, prevTxs],
  )
  const total = reportTotal(rows, metric)
  const money = isMoneyMetric(metric)
  const metricLabel = METRICS.find(m => m.id === metric)?.label ?? ''
  const title = `${metricLabel} ${GROUP_PHRASE[groupBy]}`
  // доли осмысленны только у однознаковых величин; у «чистого потока» их нет
  const pie = metric !== 'net' && !['day', 'week', 'month'].includes(groupBy)

  const chartRows = rows.slice(0, pie ? 8 : 14)
  const chart = chartRows.map(r => ({
    key: r.key, label: r.label, value: money ? toMajor(r.value) : r.value, fill: r.color,
  }))

  const current = READY.find(r => r.metric === metric && r.groupBy === groupBy)
  const stamp = new Date().toISOString().slice(0, 10)

  function open(key: string, label: string, value: number) {
    drill({
      title: label,
      subtitle: `${title} · ${range.label} · ${money ? formatMoney(value) : value}`,
      source: 'period',
      categoryId: groupBy === 'category' ? key : undefined,
      match: t => keyOf(t, groupBy) === key,
    })
  }

  function addPreset() {
    const name = prompt('Как назвать отчёт?', title)
    if (!name) return
    const next = [...presets, { name, metric, groupBy }]
    setPresets(next); savePresets(next)
    showToast('Отчёт сохранён')
  }

  const pick = (m: Metric, g: GroupBy) => { setMetric(m); setGroupBy(g) }

  return (
    <>
      {/* ── Что показываем ── */}
      <Card
        title="Отчёт"
        right={(
          <button onClick={() => setEditing(e => !e)}
            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 ${
              editing ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
            {editing ? <><Check size={12} /> Готово</> : <><Pencil size={12} /> Свой</>}
          </button>
        )}>
        <p className="text-text-primary text-lg font-bold leading-tight">{title}</p>
        {current && <p className="text-text-secondary text-xs mt-0.5">{current.question}</p>}

        {editing ? (
          <div className="flex flex-col gap-3 mt-3">
            <div>
              <p className="text-text-secondary text-[10px] uppercase tracking-wider mb-1.5">Что показать</p>
              <div className="flex gap-2 flex-wrap">
                {METRICS.map(m => (
                  <button key={m.id} onClick={() => setMetric(m.id)} className={chip(metric === m.id)}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-text-secondary text-[10px] uppercase tracking-wider mb-1.5">В разбивке по чему</p>
              <div className="flex gap-2 flex-wrap">
                {GROUPS.filter(g => g.id !== 'profile' || canSeeProfiles).map(g => (
                  <button key={g.id} onClick={() => setGroupBy(g.id)} className={chip(groupBy === g.id)}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={addPreset}
              className="h-10 rounded-xl bg-bg-card2 text-text-primary text-xs font-semibold flex items-center justify-center gap-1.5">
              <Save size={13} /> Сохранить этот отчёт
            </button>
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto scrollbar-none mt-3 -mx-1 px-1">
            {READY.filter(r => r.groupBy !== 'profile' || canSeeProfiles).map(r => (
              <button key={r.id} onClick={() => pick(r.metric, r.groupBy)}
                className={`flex-none w-40 text-left rounded-xl p-2.5 border transition-colors ${
                  current?.id === r.id ? 'bg-accent/15 border-accent/40' : 'bg-bg-card2 border-transparent'}`}>
                <p className="text-text-primary text-xs font-semibold leading-snug">{r.title}</p>
                <p className="text-text-secondary text-[10px] mt-1 leading-snug">{r.question}</p>
              </button>
            ))}
          </div>
        )}
      </Card>

      {presets.length > 0 && !editing && (
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-text-secondary text-[10px] uppercase tracking-wider">Мои отчёты</span>
          {presets.map((p, i) => (
            <span key={`${p.name}-${i}`} className="flex items-center gap-1 bg-bg-card border border-border rounded-lg pl-3 pr-1.5 py-1.5">
              <button onClick={() => pick(p.metric, p.groupBy)} className="text-text-primary text-xs">{p.name}</button>
              <button onClick={() => { const next = presets.filter((_, j) => j !== i); setPresets(next); savePresets(next) }}
                aria-label={`Удалить отчёт ${p.name}`} className="text-text-secondary">
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Итог ── */}
      <Card>
        <p className="text-text-secondary text-xs">{metricLabel} · {range.label}</p>
        <p className="text-3xl font-bold mt-1"
          style={{ color: metric === 'income' ? colors.income : metric === 'net' ? (total >= 0 ? colors.income : colors.expense) : undefined }}>
          {money ? formatMoney(total) : total}
        </p>
        <p className="text-text-secondary text-xs mt-1">{txs.length} операц. в выборке</p>
      </Card>

      {rows.length === 0 ? (
        <Empty text="Нет данных под эти условия" />
      ) : (
        <>
          <Card hint="Нажмите на любую часть — покажем операции, из которых она сложилась">
            {pie ? (
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={chart} dataKey="value" nameKey="label" innerRadius={52} outerRadius={82}
                    paddingAngle={2} className="cursor-pointer"
                    onClick={(d: { payload?: { key?: string; label?: string; value?: number } }) => {
                      const row = rows.find(r => r.key === d?.payload?.key)
                      if (row) open(row.key, row.label, row.value)
                    }}>
                    {chart.map(c => <Cell key={c.key} fill={c.fill} stroke="transparent" />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip money={money} title={it => String(it.payload?.label ?? '')} hint="Нажмите — операции" />} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(150, chart.length * 26)}>
                <BarChart data={chart} layout="vertical" margin={{ left: 0, right: 12 }}>
                  <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false}
                    tickFormatter={money ? shortMoney : undefined} />
                  <YAxis type="category" dataKey="label" width={96} tick={{ ...AXIS_TICK, fontSize: 11 }}
                    axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: CURSOR_FILL }} content={<ChartTooltip money={money} hint="Нажмите — операции" />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18} className="cursor-pointer"
                    onClick={(d: { payload?: { key?: string } }) => {
                      const row = rows.find(r => r.key === d.payload?.key)
                      if (row) open(row.key, row.label, row.value)
                    }}>
                    {chart.map(c => <Cell key={c.key} fill={c.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
            {rows.map((r, i) => (
              <button key={r.key} onClick={() => open(r.key, r.label, r.value)}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 active:bg-bg-card2 ${
                  i < rows.length - 1 ? 'border-b border-border' : ''}`}>
                <span className="w-2 h-7 rounded-full flex-none" style={{ background: r.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm font-medium truncate">{r.label}</p>
                  <p className="text-text-secondary text-xs">
                    {r.share.toFixed(1)}% · {r.count} опер.
                    {r.delta != null && (
                      <span style={{ color: r.delta > 0 ? colors.expense : colors.income }}>
                        {' '}{r.delta > 0 ? '+' : ''}{r.delta.toFixed(0)}%
                      </span>
                    )}
                  </p>
                </div>
                <p className="text-text-primary text-sm font-semibold flex-none">
                  {money ? formatMoney(r.value, true) : r.value}
                </p>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => download(`finflow-${stamp}.csv`, reportToCsv(rows, groupBy, metric, `${title} · ${range.label}`), 'text/csv')}
              className="flex-1 h-11 rounded-xl bg-bg-card border border-border text-text-primary text-xs font-semibold flex items-center justify-center gap-1.5">
              <Download size={14} /> Таблица в CSV
            </button>
            <button
              onClick={() => download(`finflow-операции-${stamp}.csv`, rawToCsv(txs, maps, `${title} · ${range.label}`), 'text/csv')}
              className="flex-1 h-11 rounded-xl bg-bg-card border border-border text-text-primary text-xs font-semibold flex items-center justify-center gap-1.5">
              <Download size={14} /> Операции в CSV
            </button>
          </div>
          <p className="text-text-secondary/70 text-[11px] text-center">
            Выгружается текущая выборка: период и условия учитываются.
          </p>
        </>
      )}
    </>
  )
}

const chip = (on: boolean) =>
  `flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
    on ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary border border-border'}`
