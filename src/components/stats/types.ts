import type { Range, Transaction } from '../../types'
import type { AmountColors, ChartModes, StatsViewId, WidgetPrefs } from '../../utils/uiPrefs'
import type { LookupMaps } from '../../utils/report'

/**
 * «Провалиться» в цифру: описание того, какие операции за ней стоят.
 *
 * Хранится условие, а не сами операции: пока шит открыт, операцию могут
 * поправить или удалить, и список обязан пересчитаться из живого запроса,
 * а не показывать снимок на момент нажатия.
 */
export interface Drill {
  title: string
  subtitle?: string
  /** из чего выбирать: операции текущего периода или вся история (для «Трендов») */
  source: 'period' | 'all'
  match: (t: Transaction) => boolean
  /** если это категория — в шите появится «оставить в выборке только её» */
  categoryId?: string
}

/** Всё, что нужно разделу аналитики. Собирается один раз в `StatsScreen`. */
export interface ViewCtx {
  /** операции периода после роли и условий выборки */
  txs: Transaction[]
  /** сопоставимый отрезок прошлого периода; пусто, если сравнивать не с чем */
  prevTxs: Transaction[]
  /** вся история после роли и условий */
  allTxs: Transaction[]
  range: Range
  /** точка в прошлом периоде, до которой он сопоставим с текущим */
  prevCutoff: string | null
  colors: AmountColors
  widgets: WidgetPrefs
  modes: ChartModes
  setMode: <K extends keyof ChartModes>(key: K, value: ChartModes[K]) => void
  maps: LookupMaps
  drill: (d: Drill) => void
  /** включён ли раздел — чтобы не вести ссылкой туда, куда не попасть */
  hasView: (v: StatsViewId) => boolean
  goTo: (v: StatsViewId) => void
}

// ── Оформление графиков ─────────────────────────────────────────────────────
// Подписи осей светлее, чем `text-secondary`: мелкий текст на тёмной карточке
// иначе не читается. Сетка едва заметная — она фон, а не содержание.

export const AXIS_TICK = { fill: '#A2A2C8', fontSize: 10 }
export const GRID_COLOR = '#2A2A42'
export const ACCENT = '#6C63FF'
export const CURSOR_FILL = '#ffffff10'

/** Подпись оси сумм: 45000 → «45к». На вход — рубли. */
export function shortMoney(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace('.', ',')}м`
  if (a >= 1000) return `${Math.round(v / 1000)}к`
  return String(Math.round(v))
}
