import { useMemo } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { categoryColor, categoryName } from '../../db/categories'
import { CategoryIcon } from '../ui/CategoryIcon'
import { ChartTooltip } from '../ui/ChartTooltip'
import { Segmented } from '../ui/Segmented'
import { Card, Empty } from './Card'
import { AXIS_TICK, CURSOR_FILL, GRID_COLOR, shortMoney, type ViewCtx } from './types'
import { formatDayKey, formatMoney, formatSigned, plural } from '../../utils/format'
import { toMajor } from '../../utils/money'
import { periodProgress } from '../../utils/period'
import {
  byCategory, forecastExpense, inBucket, timeSeries, totals,
} from '../../utils/analytics'

/**
 * Обзор периода: три итога, динамика и главные категории.
 *
 * Каждая цифра здесь раскрывается: плитка — во все операции своего типа,
 * столбик графика — в операции этого дня (или месяца, если период длинный),
 * строка категории — в операции этой категории. Раньше обзор был тупиком:
 * видно «сколько», но не видно «из чего».
 */
export function OverviewView(ctx: ViewCtx) {
  const { txs, prevTxs, range, prevCutoff, colors, widgets, modes, setMode, drill } = ctx

  const t = totals(txs)
  const prevT = totals(prevTxs)
  const series = useMemo(() => timeSeries(txs, range), [txs, range])
  const cats = useMemo(() => byCategory(txs, prevTxs), [txs, prevTxs])
  const forecast = forecastExpense(txs, range)

  const deltaExpense = prevT.expense > 0 ? ((t.expense - prevT.expense) / prevT.expense) * 100 : null
  const stepName = series.step === 'day' ? 'день' : 'месяц'

  /**
   * На графике динамики — только расходы.
   *
   * Доход приходит раз в месяц и на порядок крупнее дневной траты: общая ось
   * растягивалась до зарплаты, и все расходные столбики превращались в полоску
   * у нуля — график переставал что-либо показывать. Доходы видны в плитке выше
   * и в «Трендах», где их сравнивают по месяцам, то есть в сопоставимом масштабе.
   */
  const data = series.points.map(p => ({
    key: p.key, label: p.label, Расходы: toMajor(p.expense),
  }))

  /** Нажатие по точке ряда — операции этого дня или месяца. */
  function drillPoint(key: string | undefined) {
    if (!key) return
    const point = series.points.find(p => p.key === key)
    if (!point) return
    drill({
      title: series.step === 'day' ? formatDayKey(key) : point.label,
      subtitle: `Операции за ${stepName}`,
      source: 'period',
      match: x => inBucket(x, key),
    })
  }

  /**
   * Нажатие по линии или области: recharts отдаёт точку, ближайшую к курсору.
   * Тип состояния графика в типах recharts выражен шире, чем нам нужно,
   * поэтому разбираем его сами и проверяем то, чем пользуемся.
   */
  const onChartClick = (state: unknown) => {
    const item = (state as { activePayload?: { payload?: { key?: unknown } }[] })?.activePayload?.[0]
    const key = item?.payload?.key
    if (typeof key === 'string') drillPoint(key)
  }

  if (!txs.length) return <Empty />

  return (
    <>
      {/* ── Итоги ── */}
      <div className="grid grid-cols-3 gap-2">
        {([
          { id: 'expense', label: 'Расходы', value: t.expense, color: colors.expense },
          { id: 'income', label: 'Доходы', value: t.income, color: colors.income },
          { id: 'net', label: 'Итого', value: t.net, color: t.net >= 0 ? colors.income : colors.expense },
        ] as const).map(i => (
          <button key={i.id}
            onClick={() => drill({
              title: i.label,
              subtitle: range.label,
              source: 'period',
              match: i.id === 'net' ? () => true : x => x.type === i.id,
            })}
            className="bg-bg-card border border-border rounded-2xl p-3 text-left active:scale-[0.98] transition-transform min-w-0">
            <p className="text-text-secondary text-[10px]">{i.label}</p>
            {/* truncate: на узком экране «+114,9 тыс. ₽» вылезал за карточку */}
            <p className="text-[13px] font-bold mt-1 truncate" style={{ color: i.color }}>
              {i.id === 'net' ? formatSigned(i.value, true) : formatMoney(i.value, true)}
            </p>
          </button>
        ))}
      </div>

      {/* ── Динамика ── */}
      {data.length > 1 && (
        <Card
          title={`Расходы по ${series.step === 'day' ? 'дням' : 'месяцам'}`}
          hint={`Нажмите на столбик — покажем операции за этот ${stepName}`}
          right={(
            <Segmented label="Вид графика" value={modes.flow} onChange={v => setMode('flow', v)}
              options={[
                { id: 'bars', label: '▮', title: 'Столбцы' },
                { id: 'area', label: '◣', title: 'Область' },
                { id: 'line', label: '∿', title: 'Линия' },
              ]} />
          )}>
          <ResponsiveContainer width="100%" height={170}>
            {modes.flow === 'bars' ? (
              <BarChart data={data} margin={{ left: -14, right: 6, top: 4 }}>
                <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={14} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={shortMoney} width={46} />
                <Tooltip cursor={{ fill: CURSOR_FILL }}
                  content={<ChartTooltip hint="Нажмите, чтобы увидеть операции" />} />
                <Bar dataKey="Расходы" radius={[3, 3, 0, 0]} maxBarSize={26} className="cursor-pointer"
                  onClick={(d: { payload?: { key?: string } }) => drillPoint(d.payload?.key)}>
                  {data.map(d => <Cell key={d.key} fill={colors.expense} />)}
                </Bar>

              </BarChart>
            ) : modes.flow === 'area' ? (
              /* нажатие ловим на уровне графика: у точки линии свой тип обработчика,
                 и попасть пальцем в саму точку всё равно трудно */
              <AreaChart data={data} margin={{ left: -14, right: 6, top: 4 }} onClick={onChartClick}>
                <defs>
                  <linearGradient id="flowExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.expense} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={colors.expense} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={14} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={shortMoney} width={46} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="Расходы" stroke={colors.expense} strokeWidth={2}
                  fill="url(#flowExp)" activeDot={{ r: 4 }} />

              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ left: -14, right: 6, top: 4 }} onClick={onChartClick}>
                <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={14} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={shortMoney} width={46} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="Расходы" stroke={colors.expense} strokeWidth={2} dot={false}
                  activeDot={{ r: 4 }} />

              </LineChart>
            )}
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Главные категории ── */}
      {cats.length > 0 && (
        <Card title={`На что ушло · ${formatMoney(t.expense, true)}`}
          hint="Нажмите на строку — покажем операции этой категории">
          <div className="flex flex-col gap-3">
            {cats.slice(0, 5).map(c => (
              <button key={c.categoryId} className="w-full text-left"
                onClick={() => drill({
                  title: categoryName(c.categoryId),
                  subtitle: `${range.label} · ${formatMoney(c.amount)}`,
                  source: 'period',
                  categoryId: c.categoryId,
                  match: x => x.categoryId === c.categoryId,
                })}>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <p className="text-text-primary text-sm flex items-center gap-1.5 min-w-0">
                    <CategoryIcon id={c.categoryId} size={16} />
                    <span className="truncate">{categoryName(c.categoryId)}</span>
                    <span className="text-text-secondary text-xs flex-none">×{c.count}</span>
                  </p>
                  <span className="text-text-primary text-xs font-semibold flex-none">
                    {formatMoney(c.amount, true)}
                    <span className="text-text-secondary font-normal"> · {c.share.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-bg-card2 overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${Math.max(2, c.share)}%`, background: categoryColor(c.categoryId) }} />
                </div>
              </button>
            ))}
          </div>
          {cats.length > 5 && ctx.hasView('categories') && (
            <button onClick={() => ctx.goTo('categories')} className="text-accent text-xs font-medium mt-3">
              Все категории ({cats.length}) →
            </button>
          )}
        </Card>
      )}

      {/* ── Сравнение и прогноз ── */}
      {widgets.deltaPrev && deltaExpense != null && (
        <Card>
          <p className="text-text-secondary text-[11px]">К прошлому периоду</p>
          <p className="text-lg font-bold mt-0.5"
            style={{ color: deltaExpense > 0 ? colors.expense : colors.income }}>
            {deltaExpense > 0 ? '+' : ''}{deltaExpense.toFixed(0)}%
          </p>
          {/* видно, что сравниваются равные отрезки, а не «часть против целого» */}
          <p className="text-text-secondary text-[11px] mt-0.5">
            {prevCutoff ? 'за те же дни: ' : ''}
            {formatMoney(t.expense, true)} против {formatMoney(prevT.expense, true)}
          </p>
        </Card>
      )}

      {widgets.structure && t.expense > 0 && (
        <Card title="Структура расходов" hint="Обязательные траты против остального">
          <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-bg-card2">
            <div style={{ width: `${(t.essential / t.expense) * 100}%` }} className="bg-accent" />
            <div style={{ width: `${(t.discretionary / t.expense) * 100}%` }} className="bg-accent-yellow" />
          </div>
          <div className="flex justify-between mt-3 text-xs">
            <span className="text-text-secondary">🔵 Обязательные {formatMoney(t.essential, true)}</span>
            <span className="text-text-secondary">🟡 Остальное {formatMoney(t.discretionary, true)}</span>
          </div>
        </Card>
      )}

      {widgets.forecast && forecast != null && (
        <div className="bg-accent/10 border border-accent/20 rounded-2xl p-4">
          <p className="text-text-secondary text-xs mb-1">Прогноз на конец периода</p>
          <p className="text-text-primary text-xl font-bold">{formatMoney(forecast)}</p>
          <p className="text-text-secondary text-xs mt-1">
            Прошло {(periodProgress(range) * 100).toFixed(0)}% периода, потрачено {formatMoney(t.expense, true)}
          </p>
        </div>
      )}

      <p className="text-text-secondary/70 text-[11px] text-center">
        {t.txCount} {plural(t.txCount, 'операция', 'операции', 'операций')} в статистике за {range.label.toLowerCase()}
      </p>
    </>
  )
}
