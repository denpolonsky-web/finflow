import { useMemo } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Repeat } from 'lucide-react'
import { CategoryIcon } from '../ui/CategoryIcon'
import { ChartTooltip } from '../ui/ChartTooltip'
import { Segmented } from '../ui/Segmented'
import { Card, Empty } from './Card'
import { AXIS_TICK, CURSOR_FILL, GRID_COLOR, shortMoney, type ViewCtx } from './types'
import { formatDateShort, formatMoney, monthTitle } from '../../utils/format'
import { toMajor } from '../../utils/money'
import { detectSubscriptions, inBucket, monthlyTotals, timeSeries } from '../../utils/analytics'

/**
 * Тренды: как менялись доходы и расходы по месяцам.
 *
 * Берёт ВСЮ историю, а не период: смысл раздела — длинная картина. Поэтому
 * и проваливаться отсюда надо во всю историю, иначе нажатие на «август»
 * из ноябрьского периода показывало бы пусто.
 */
export function TrendsView(ctx: ViewCtx) {
  const { allTxs, txs, range, colors, widgets, modes, setMode, drill } = ctx

  const months = useMemo(() => monthlyTotals(allTxs, modes.trendMonths), [allTxs, modes.trendMonths])
  const subs = useMemo(() => detectSubscriptions(allTxs), [allTxs])
  const period = useMemo(() => timeSeries(txs, range), [txs, range])

  const data = months.map(m => ({
    key: m.key, label: m.label,
    Расходы: toMajor(m.expense), Доходы: toMajor(m.income),
  }))
  const empty = months.every(m => m.expense === 0 && m.income === 0)

  function openMonth(key: string | undefined) {
    if (!key) return
    drill({
      title: monthTitle(key),
      subtitle: 'Все операции месяца',
      source: 'all',
      match: t => inBucket(t, key),
    })
  }

  if (empty) return <Empty text="Истории ещё мало — графику не из чего строиться" />

  return (
    <>
      <Card
        title={`Доходы и расходы · ${modes.trendMonths} мес`}
        hint="Нажмите на месяц — покажем все его операции"
        right={(
          <Segmented label="Горизонт" value={modes.trendMonths} onChange={v => setMode('trendMonths', v)}
            options={[{ id: 6, label: '6м' }, { id: 12, label: '12м' }]} />
        )}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ left: -14, right: 6, top: 4 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={6} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={shortMoney} width={46} />
            <Tooltip cursor={{ fill: CURSOR_FILL }} content={<ChartTooltip hint="Нажмите — операции месяца" />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#A2A2C8' }} />
            <Bar dataKey="Доходы" radius={[3, 3, 0, 0]} maxBarSize={18} fill={colors.income} className="cursor-pointer"
              onClick={(d: { payload?: { key?: string } }) => openMonth(d.payload?.key)} />
            <Bar dataKey="Расходы" radius={[3, 3, 0, 0]} maxBarSize={18} className="cursor-pointer"
              onClick={(d: { payload?: { key?: string } }) => openMonth(d.payload?.key)}>
              {data.map(d => <Cell key={d.key} fill={colors.expense} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title={`Чистый поток · ${modes.trendMonths} мес`}
        hint="Сколько оставалось каждый месяц: выше нуля — отложили, ниже — потратили больше, чем заработали">
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={months.map(m => ({ label: m.label, Остаток: toMajor(m.income - m.expense) }))}
            margin={{ left: -14, right: 6, top: 4 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={6} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={shortMoney} width={46} />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey="Остаток" stroke="#6C63FF" strokeWidth={2} dot={{ r: 2.5 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {widgets.cumulative && period.points.length > 1 && (
        <Card title={`Накопительный расход · ${range.label.toLowerCase()}`}
          hint="Как расход набирался с начала периода">
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={period.points.map(p => ({ label: p.label, Накоплено: toMajor(p.cumulative) }))}
              margin={{ left: -14, right: 6, top: 4 }}>
              <defs>
                <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6C63FF" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#6C63FF" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={14} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={shortMoney} width={46} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="Накоплено" stroke="#6C63FF" strokeWidth={2} fill="url(#cumFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {widgets.subscriptions && subs.length > 0 && (
        <Card title="Похоже на подписки" hint="Догадка по повторяющимся платежам — одно название, близкая сумма, раз в месяц">
          <div className="flex items-center gap-2 mb-3">
            <Repeat size={14} className="text-accent" />
            <p className="text-text-secondary text-xs">
              Итого в месяц: {formatMoney(subs.reduce((s, x) => s + x.amount, 0))}
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            {subs.map(s => (
              /* ключ по названию + сумме: detectSubscriptions группирует ещё и по
                 сумме, и две группы с одним названием давали одинаковый ключ */
              <button key={`${s.title}|${s.amount}`} className="flex items-center gap-3 text-left"
                onClick={() => drill({
                  title: s.title,
                  subtitle: `${s.count} списаний`,
                  source: 'all',
                  match: t => t.title.trim().toLowerCase() === s.title.trim().toLowerCase(),
                })}>
                <CategoryIcon id={s.categoryId} size={22} />
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm truncate">{s.title}</p>
                  <p className="text-text-secondary text-[11px]">
                    {s.count} списаний, последнее {formatDateShort(s.lastDate)}
                  </p>
                </div>
                <p className="text-text-primary text-sm font-semibold flex-none">{formatMoney(s.amount, true)}</p>
              </button>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
