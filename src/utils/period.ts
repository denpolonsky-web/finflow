import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  addMonths, addWeeks, addQuarters, addYears, format, isSameMonth,
  addDays, startOfDay, endOfDay,
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
    case 'day': {
      const base = addDays(now, offset)
      return {
        from: startOfDay(base), to: endOfDay(base),
        label: offset === 0 ? 'Сегодня'
          : offset === -1 ? 'Вчера'
            : format(base, 'd MMMM yyyy', { locale: ru }),
      }
    }
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
      // Обе границы разбираем как ЛОКАЛЬНОЕ время. Раньше `new Date('2026-01-01')`
      // давал UTC-полночь, а `to` собирался из строки с временем и был локальным —
      // начало и конец периода жили в разных системах, и граница плыла
      // на величину часового пояса.
      const from = customFrom ? new Date(`${customFrom}T00:00:00`) : startOfMonth(now)
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

/**
 * Точка в прошлом периоде, до которой он сопоставим с текущим: столько же
 * времени от его начала, сколько уже прошло в текущем. ISO-строка или `null`,
 * если период уже закончился (тогда сравнивать можно целиком) или ещё не начался.
 *
 * Нужна, чтобы сравнение «к прошлому периоду» не врало: 7 ноября неделя
 * сопоставлялась с целым октябрём и давала −81%, что читается как «стал
 * тратить втрое меньше», хотя означает «месяц ещё не кончился».
 */
export function comparableCutoff(range: Range, prev: Range, now = Date.now()): string | null {
  const elapsed = now - range.from.getTime()
  if (elapsed <= 0 || now >= range.to.getTime()) return null
  return new Date(prev.from.getTime() + elapsed).toISOString()
}

/** Доля периода, которая уже прошла: 0..1. Для pacing бюджетов. */
export function periodProgress(r: Range): number {
  const now = Date.now()
  if (now <= r.from.getTime()) return 0
  if (now >= r.to.getTime()) return 1
  return (now - r.from.getTime()) / (r.to.getTime() - r.from.getTime())
}
