import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  addMonths, addWeeks, addQuarters, addYears, format, isSameMonth,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import type { PeriodId, Range } from '../types'

/**
 * offset = 0 — текущий период, −1 — предыдущий и т.д.
 * У периода настоящий конец, а не `now` — поэтому прошлые месяцы открываются.
 */
export function getRange(period: PeriodId, offset = 0, customFrom?: string, customTo?: string): Range {
  const now = new Date()
  switch (period) {
    case 'week': {
      const base = addWeeks(now, offset)
      const from = startOfWeek(base, { weekStartsOn: 1 })
      const to = endOfWeek(base, { weekStartsOn: 1 })
      return {
        from, to,
        label: offset === 0
          ? 'Эта неделя'
          : `${format(from, 'd MMM', { locale: ru })} — ${format(to, 'd MMM', { locale: ru })}`,
      }
    }
    case 'quarter': {
      const base = addQuarters(now, offset)
      return {
        from: startOfQuarter(base), to: endOfQuarter(base),
        label: `${Math.floor(base.getMonth() / 3) + 1} квартал ${base.getFullYear()}`,
      }
    }
    case 'year': {
      const base = addYears(now, offset)
      return { from: startOfYear(base), to: endOfYear(base), label: String(base.getFullYear()) }
    }
    case 'custom': {
      const from = customFrom ? new Date(customFrom) : startOfMonth(now)
      const to = customTo ? new Date(`${customTo}T23:59:59.999`) : now
      return {
        from, to,
        label: `${format(from, 'd MMM yy', { locale: ru })} — ${format(to, 'd MMM yy', { locale: ru })}`,
      }
    }
    case 'month':
    default: {
      const base = addMonths(now, offset)
      return {
        from: startOfMonth(base), to: endOfMonth(base),
        label: isSameMonth(base, now)
          ? 'Этот месяц'
          : format(base, 'LLLL yyyy', { locale: ru }).replace(/^./, c => c.toUpperCase()),
      }
    }
  }
}

/** Доля периода, которая уже прошла: 0..1. Для pacing бюджетов. */
export function periodProgress(r: Range): number {
  const now = Date.now()
  if (now <= r.from.getTime()) return 0
  if (now >= r.to.getTime()) return 1
  return (now - r.from.getTime()) / (r.to.getTime() - r.from.getTime())
}
