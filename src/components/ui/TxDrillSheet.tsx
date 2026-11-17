import { useMemo, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Sheet } from './Sheet'
import { TxList } from './TxList'
import { ChartTooltip } from './ChartTooltip'
import { useApp } from '../../store/AppContext'
import { formatMoney, isoDateOnly, plural } from '../../utils/format'
import { toMajor } from '../../utils/money'
import { byDayBlocks, totals } from '../../utils/analytics'
import { cutAtDayEnd } from '../../utils/txGroups'
import type { AmountColors } from '../../utils/uiPrefs'
import type { Transaction } from '../../types'

/** Сколько операций показываем сразу; остальное — кнопкой, чтобы шит открывался мгновенно. */
const PAGE = 80

interface Props {
  title: string
  subtitle?: string
  /** операции, из которых сложилась цифра, на которую нажали; порядок любой */
  txs: Transaction[]
  colors: AmountColors
  accounts: { id: string; name: string }[]
  onClose: () => void
  /** действие под итогами — например, «оставить в выборке только эту категорию» */
  action?: { label: string; run: () => void }
}

/**
 * «Провалиться» в цифру: что за операции стоят за столбиком, сектором,
 * строкой отчёта или днём.
 *
 * Один шит на все места, откуда можно провалиться, намеренно: любая сводная
 * цифра в аналитике раскрывается одинаково — итог, раскладка по дням и сами
 * операции с датами. Нажатие на операцию открывает её на правку поверх шита,
 * и после правки цифры здесь пересчитываются сами: список приходит из живого
 * запроса экрана, а не хранится копией.
 */
export function TxDrillSheet({ title, subtitle, txs, colors, accounts, onClose, action }: Props) {
  const { setEditTx } = useApp()
  const [limit, setLimit] = useState(PAGE)

  // свежие сверху; тай-брейк по id, чтобы порядок не плавал между перерисовками
  const sorted = useMemo(
    () => [...txs].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    [txs],
  )
  const t = totals(sorted)
  // страница дорисовывается до конца дня — иначе итог последнего дня был бы по части операций
  const visible = sorted.slice(0, cutAtDayEnd(sorted, limit))
  const months = new Set(sorted.map(x => isoDateOnly(x.date).slice(0, 7))).size

  /** Раскладка по дням — от старых к свежим, как на любой оси времени. */
  const days = useMemo(() => byDayBlocks(sorted).filter(d => d.expense > 0).reverse(), [sorted])
  const chart = days.map(d => {
    const [, m, dd] = d.date.split('-')
    return { key: d.date, label: `${Number(dd)}.${m}`, value: toMajor(d.expense), heavy: d.heavy }
  })

  /** Нажатие на столбик прокручивает список к этому дню. */
  function scrollToDay(key: string) {
    const idx = sorted.findIndex(x => isoDateOnly(x.date) === key)
    if (idx < 0) return
    // день ещё не дорисован — сначала дорисовываем до него
    if (idx >= visible.length) setLimit(idx + PAGE)
    setTimeout(() => {
      document.querySelector(`[data-drill] [data-day="${key}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
  }

  return (
    <Sheet open title={title} subtitle={subtitle} onClose={onClose}>
      {sorted.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-2">🔍</p>
          <p className="text-text-secondary text-sm">Операций здесь нет</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-drill>
          <div className="flex gap-2">
            {t.expense > 0 && (
              <div className="flex-1 bg-bg-card2 rounded-2xl p-3">
                <p className="text-text-secondary text-[11px]">Расходы</p>
                <p className="text-lg font-bold mt-0.5" style={{ color: colors.expense }}>{formatMoney(t.expense)}</p>
              </div>
            )}
            {t.income > 0 && (
              <div className="flex-1 bg-bg-card2 rounded-2xl p-3">
                <p className="text-text-secondary text-[11px]">Доходы</p>
                <p className="text-lg font-bold mt-0.5" style={{ color: colors.income }}>{formatMoney(t.income)}</p>
              </div>
            )}
            <div className="flex-none bg-bg-card2 rounded-2xl p-3 min-w-[5.5rem]">
              <p className="text-text-secondary text-[11px]">Операций</p>
              <p className="text-lg font-bold mt-0.5 text-text-primary">{sorted.length}</p>
            </div>
          </div>

          {action && (
            <button onClick={action.run}
              className="w-full h-10 rounded-xl bg-accent/15 border border-accent/30 text-accent text-xs font-semibold">
              {action.label}
            </button>
          )}

          {chart.length > 1 && (
            <div className="bg-bg-card2 rounded-2xl p-3">
              <p className="text-text-secondary text-[11px] mb-2">
                По дням · {chart.length} {plural(chart.length, 'день', 'дня', 'дней')} с тратами
              </p>
              <ResponsiveContainer width="100%" height={96}>
                <BarChart data={chart} margin={{ top: 4, left: 0, right: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fill: '#8C8CB4', fontSize: 9 }} axisLine={false} tickLine={false}
                    interval="preserveStartEnd" minTickGap={12} />
                  <Tooltip cursor={{ fill: '#ffffff10' }}
                    content={<ChartTooltip seriesName="Расходы" hint="Нажмите — список прокрутится к этому дню" />} />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={22} className="cursor-pointer"
                    onClick={(d: { payload?: { key?: string } }) => { if (d.payload?.key) scrollToDay(d.payload.key) }}>
                    {chart.map(d => <Cell key={d.key} fill={colors.expense} fillOpacity={d.heavy ? 1 : 0.6} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Итог дня здесь верный: в списке лежат ВСЕ операции выборки за день
              (страница дорезается до конца дня). Это итог выборки, а не дня
              целиком — ровно то, что обещает заголовок шита. */}
          <TxList items={visible} onPick={setEditTx} colors={colors} accounts={accounts}
            showMonths={months > 1} showEdit />

          {visible.length < sorted.length && (
            <button onClick={() => setLimit(n => n + PAGE)}
              className="w-full h-10 rounded-xl bg-bg-card2 text-text-primary text-xs font-semibold">
              Показать ещё · осталось {sorted.length - visible.length}
            </button>
          )}
        </div>
      )}
    </Sheet>
  )
}
