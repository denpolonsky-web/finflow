import { useMemo } from 'react'
import { categoryName } from '../../db/categories'
import { CategoryIcon } from '../ui/CategoryIcon'
import { Segmented } from '../ui/Segmented'
import { Card, Empty } from './Card'
import type { ViewCtx } from './types'
import { formatDayKey, formatMoney, isoDateOnly, plural } from '../../utils/format'
import { byDayBlocks, inBucket, type DayBlock } from '../../utils/analytics'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/**
 * Дни периода: список блоков или календарь-теплокарта.
 *
 * И там и там день раскрывается в свои операции — это и было главной дырой:
 * «Детализация и динамика» показывала итог дня, но провалиться в него
 * и посмотреть сами траты было нельзя.
 */
export function DaysView(ctx: ViewCtx) {
  const { txs, colors, modes, setMode, drill } = ctx
  const blocks = useMemo(() => byDayBlocks(txs), [txs])

  function openDay(d: DayBlock) {
    drill({
      title: formatDayKey(d.date),
      subtitle: `${d.count} ${plural(d.count, 'операция', 'операции', 'операций')} · ${formatMoney(d.expense)}`,
      source: 'period',
      match: t => inBucket(t, d.date),
    })
  }

  if (!blocks.length) return <Empty />

  return (
    <>
      <Card
        title={`Дни с операциями · ${blocks.length}`}
        hint="Нажмите на день — покажем все его операции"
        right={(
          <Segmented label="Вид" value={modes.days} onChange={v => setMode('days', v)}
            options={[
              { id: 'list', label: '☰', title: 'Список' },
              { id: 'calendar', label: '▦', title: 'Календарь' },
            ]} />
        )}>
        {modes.days === 'calendar'
          ? <Calendar blocks={blocks} color={colors.expense} onPick={openDay} />
          : <p className="text-text-secondary text-[11px]">
              Полоска — вес дня относительно самого дорогого в периоде.
            </p>}
      </Card>

      {modes.days === 'list' && (
        <div className="flex flex-col gap-2.5">
          {blocks.map(d => (
            <button key={d.date} onClick={() => openDay(d)}
              className={`text-left rounded-2xl border p-4 active:scale-[0.99] transition-transform ${
                d.heavy ? 'border-accent-red/25 bg-accent-red/5' : 'border-border bg-bg-card'}`}>
              <div className="flex items-baseline justify-between mb-2 gap-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  {/* ключ дня, а не ISO: `formatDate('2026-11-07')` разбирает
                      строку как UTC-полночь и в минусовом поясе печатает «Вчера» */}
                  <p className="text-text-primary text-sm font-semibold">{formatDayKey(d.date)}</p>
                  <span className="text-text-secondary text-[11px] flex-none">
                    {d.count} {plural(d.count, 'операция', 'операции', 'операций')}
                  </span>
                </div>
                <div className="text-right flex-none">
                  {d.expense > 0 && (
                    <p className="text-sm font-bold" style={{ color: colors.expense }}>
                      −{formatMoney(d.expense, true)}
                    </p>
                  )}
                  {d.income > 0 && (
                    <p className="text-xs font-semibold" style={{ color: colors.income }}>
                      +{formatMoney(d.income, true)}
                    </p>
                  )}
                </div>
              </div>

              <div className="h-1.5 rounded-full bg-bg-card2 overflow-hidden mb-3">
                <div className="h-full rounded-full"
                  style={{ width: `${Math.max(2, d.weight * 100)}%`, background: colors.expense }} />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {d.categories.map(c => (
                  <span key={c.categoryId}
                    className="inline-flex items-center gap-1 bg-bg-card2 rounded-lg px-2 py-1 text-[11px] text-text-secondary">
                    <CategoryIcon id={c.categoryId} size={14} />
                    <span className="truncate max-w-[9rem]">{categoryName(c.categoryId)}</span>
                    <span className="text-text-primary font-semibold">{formatMoney(c.amount, true)}</span>
                    {c.count > 1 && <span className="text-text-secondary">×{c.count}</span>}
                  </span>
                ))}
              </div>

              {d.heavy && (
                <p className="text-accent-red text-[11px] mt-2.5">Дороже обычного дня в этом периоде</p>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Теплокарта по неделям. Месяцы идут сверху вниз, недели — строками
 * с понедельника: так видно и недельный ритм, и «дорогие» пятна.
 *
 * Пустые дни рисуем бледными, но рисуем: пропуск клетки сломал бы сетку,
 * а отсутствие трат — это тоже факт.
 */
function Calendar({ blocks, color, onPick }: {
  blocks: DayBlock[]; color: string; onPick: (d: DayBlock) => void
}) {
  const byDate = new Map(blocks.map(b => [b.date, b]))
  const dates = blocks.map(b => b.date).sort()
  const first = new Date(`${dates[0]}T00:00:00`)
  const last = new Date(`${dates[dates.length - 1]}T00:00:00`)
  const max = blocks.reduce((m, b) => Math.max(m, b.expense), 0)

  // выравниваем начало на понедельник — иначе колонки не совпадут с подписями
  const start = new Date(first)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))

  const cells: { key: string; block?: DayBlock; outside: boolean }[] = []
  for (const d = new Date(start); d <= last; d.setDate(d.getDate() + 1)) {
    const key = isoDateOnly(d.toISOString())
    cells.push({ key, block: byDate.get(key), outside: d < first })
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map(w => (
          <span key={w} className="text-text-secondary/70 text-[9px] text-center">{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map(c => {
          const weight = c.block && max > 0 ? c.block.expense / max : 0
          const day = Number(c.key.slice(8))
          return (
            <button key={c.key} disabled={!c.block}
              onClick={() => c.block && onPick(c.block)}
              title={c.block ? `${formatDayKey(c.key)} · ${formatMoney(c.block.expense)}` : undefined}
              className={`aspect-square rounded-md text-[10px] font-semibold flex items-center justify-center transition-transform ${
                c.block ? 'text-white active:scale-90' : 'text-text-secondary/40'} ${c.outside ? 'opacity-30' : ''}`}
              style={{
                // 0.18 — нижний порог: при совсем бледном фоне клетка сливалась с карточкой
                background: c.block ? hexAlpha(color, 0.18 + weight * 0.82) : '#1C1C2E',
              }}>
              {day}
            </button>
          )
        })}
      </div>
      <p className="text-text-secondary/70 text-[11px] mt-2">
        Чем ярче клетка, тем больше потрачено в этот день.
      </p>
    </div>
  )
}

/** `#rrggbb` + прозрачность → `rgba(...)`: Tailwind тут не поможет, цвет из настроек. */
function hexAlpha(hex: string, a: number): string {
  const s = hex.replace('#', '')
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(2)})`
}
