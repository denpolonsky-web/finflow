import { useMemo } from 'react'
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { CategoryIcon } from '../ui/CategoryIcon'
import { ChartTooltip } from '../ui/ChartTooltip'
import { Segmented } from '../ui/Segmented'
import { Card, Empty } from './Card'
import { AXIS_TICK, CURSOR_FILL, shortMoney, type ViewCtx } from './types'
import { formatMoney, plural } from '../../utils/format'
import { toMajor } from '../../utils/money'
import { buildReport, keyOf, type GroupBy, type Metric } from '../../utils/report'
import { statsOnly } from '../../utils/analytics'

interface Props extends ViewCtx {
  groupBy: GroupBy
  metric: Metric
  /** заголовок карточки с общей суммой */
  totalLabel: string
  /** значок строки — есть только у категорий */
  icons?: boolean
  /** раскладка по дням недели: порядок задан, круговая диаграмма бессмысленна */
  forceBars?: boolean
}

/**
 * Любая раскладка «по чему-то»: категории, счета, источники дохода, дни недели.
 *
 * Разделы отличаются только разрезом и показателем, поэтому экран один.
 * Главное здесь — ОБЩАЯ СУММА сверху: раньше раздел «Категории» показывал
 * диаграмму и проценты, а от чего эти проценты — приходилось складывать в уме.
 *
 * Провалиться можно и в сектор диаграммы, и в строку списка: оба ведут в одни
 * и те же операции, разложенные по дням.
 */
export function BreakdownView(props: Props) {
  const { txs, prevTxs, maps, colors, modes, setMode, range, drill, groupBy, metric, totalLabel, icons, forceBars } = props

  const rows = useMemo(
    () => buildReport(statsOnly(txs), groupBy, metric, maps, statsOnly(prevTxs)),
    [txs, prevTxs, groupBy, metric, maps],
  )
  const total = rows.reduce((s, r) => s + r.value, 0)
  const count = rows.reduce((s, r) => s + r.count, 0)
  const mode = forceBars ? 'bars' : modes.breakdown

  /** Сектор и строка ведут в одно и то же — условие собирается из ключа разреза. */
  function open(key: string, label: string, value: number) {
    drill({
      title: label,
      subtitle: `${range.label} · ${formatMoney(value)}`,
      source: 'period',
      categoryId: groupBy === 'category' ? key : undefined,
      match: t => keyOf(t, groupBy) === key && (metric === 'income' ? t.type === 'income' : t.type === 'expense'),
    })
  }

  if (!rows.length) return <Empty />

  // в круговой больше восьми секторов читать невозможно — остальное в «Прочее»
  const TOP = 8
  const head = rows.slice(0, TOP)
  const rest = rows.slice(TOP)
  const restSum = rest.reduce((s, r) => s + r.value, 0)
  const pie = restSum > 0
    ? [...head.map(r => ({ ...r })), {
      key: '__rest', label: `Ещё ${rest.length}`, color: '#44445E',
      value: restSum, count: 0, expenseCount: 0,
      share: (restSum / Math.max(1, total)) * 100, delta: null,
    }]
    : head
  const bars = rows.slice(0, 14).map(r => ({ key: r.key, label: r.label, value: toMajor(r.value), fill: r.color }))

  return (
    <>
      {/* ── Общая сумма: главный параметр раздела ── */}
      <Card>
        <p className="text-text-secondary text-xs">{totalLabel} · {range.label}</p>
        <p className="text-3xl font-bold mt-1"
          style={{ color: metric === 'income' ? colors.income : colors.expense }}>
          {formatMoney(total)}
        </p>
        <p className="text-text-secondary text-xs mt-1">
          {rows.length} {plural(rows.length, 'строка', 'строки', 'строк')} ·{' '}
          {count} {plural(count, 'операция', 'операции', 'операций')}
        </p>
      </Card>

      {/* ── График ── */}
      <Card
        hint="Нажмите на сектор или строку — покажем, из каких операций это сложилось"
        right={forceBars ? undefined : (
          <Segmented label="Вид" value={modes.breakdown} onChange={v => setMode('breakdown', v)}
            options={[
              { id: 'donut', label: '◕', title: 'Кольцо' },
              { id: 'bars', label: '▤', title: 'Полосы' },
            ]} />
        )}>
        {mode === 'donut' ? (
          <div className="flex gap-4 items-center">
            {/* фиксированная ширина обёрткой: ResponsiveContainer внутри flex
                меряет родителя, а тот ужимался до нуля — кольцо не рисовалось */}
            <div className="w-[140px] h-[150px] flex-none">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="label" innerRadius={42} outerRadius={66}
                  paddingAngle={2} startAngle={90} endAngle={-270} className="cursor-pointer"
                  onClick={(d: { payload?: { key?: string; label?: string; value?: number } }) => {
                    const p = d?.payload
                    if (p?.key && p.key !== '__rest') open(p.key, p.label ?? '', p.value ?? 0)
                  }}>
                  {pie.map(r => <Cell key={r.key} fill={r.color} stroke="transparent" />)}
                </Pie>
                <Tooltip content={<ChartTooltip title={it => String(it.payload?.label ?? '')} hint="Нажмите — операции" />} />
              </PieChart>
            </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              {pie.map(r => (
                <button key={r.key} disabled={r.key === '__rest'}
                  onClick={() => open(r.key, r.label, r.value)}
                  className="flex items-center gap-2 text-left min-w-0 disabled:cursor-default">
                  <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: r.color }} />
                  <span className="text-xs text-text-secondary flex-1 truncate">{r.label}</span>
                  <span className="text-xs text-text-primary font-semibold flex-none">{r.share.toFixed(0)}%</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(140, bars.length * 26)}>
            <BarChart data={bars} layout="vertical" margin={{ left: 0, right: 12 }}>
              <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={shortMoney} />
              <YAxis type="category" dataKey="label" width={96} tick={{ ...AXIS_TICK, fontSize: 11 }}
                axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: CURSOR_FILL }} content={<ChartTooltip hint="Нажмите — операции" />} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18} className="cursor-pointer"
                onClick={(d: { payload?: { key?: string; label?: string } }) => {
                  const row = rows.find(r => r.key === d.payload?.key)
                  if (row) open(row.key, row.label, row.value)
                }}>
                {bars.map(b => <Cell key={b.key} fill={b.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* ── Подробная разбивка ── */}
      <Card title="Подробно" hint="Сумма, доля, число операций и изменение к прошлому периоду">
        <div className="flex flex-col gap-3">
          {rows.map(r => (
            <button key={r.key} onClick={() => open(r.key, r.label, r.value)} className="w-full text-left">
              <div className="flex items-center justify-between mb-1 gap-2">
                <p className="text-text-primary text-sm flex items-center gap-1.5 min-w-0">
                  {icons && <CategoryIcon id={r.key} size={16} />}
                  <span className="truncate">{r.label}</span>
                  <span className="text-text-secondary text-xs flex-none">×{r.count}</span>
                </p>
                <div className="flex items-center gap-2 flex-none">
                  {r.delta != null && Math.abs(r.delta) >= 5 && (
                    <span className="text-[10px] font-semibold"
                      style={{ color: r.delta > 0 ? colors.expense : colors.income }}>
                      {r.delta > 0 ? '+' : ''}{r.delta.toFixed(0)}%
                    </span>
                  )}
                  <span className="text-text-primary text-xs font-semibold">{formatMoney(r.value, true)}</span>
                  <span className="text-text-secondary text-[11px] w-9 text-right">{r.share.toFixed(0)}%</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-bg-card2 overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(2, r.share)}%`, background: r.color }} />
              </div>
            </button>
          ))}
        </div>
      </Card>
    </>
  )
}
