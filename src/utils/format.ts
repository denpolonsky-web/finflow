import { format, isToday, isYesterday } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { Minor } from '../types'
import { toMajor } from './money'

const rub = (opts: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', ...opts })

/**
 * Копейки показываем всегда, когда они есть — иначе итоги «не бьются» на глаз.
 * compact — для плиток: от 100 000 ₽ переходим в сокращённую запись.
 */
export function formatMoney(m: Minor, compact = false): string {
  const v = toMajor(m)
  if (compact && Math.abs(v) >= 100_000) {
    return rub({ notation: 'compact', maximumFractionDigits: 1 }).format(v)
  }
  const hasKopecks = m % 100 !== 0
  return rub({
    minimumFractionDigits: hasKopecks ? 2 : 0,
    maximumFractionDigits: hasKopecks ? 2 : 0,
  }).format(v)
}

export function formatSigned(m: Minor, compact = false): string {
  return (m > 0 ? '+' : m < 0 ? '−' : '') + formatMoney(Math.abs(m), compact)
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  if (isToday(d)) return 'Сегодня'
  if (isYesterday(d)) return 'Вчера'
  return format(d, 'd MMMM yyyy', { locale: ru })
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : format(d, 'HH:mm')
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'd MMM', { locale: ru })
}

/** ISO → значение для <input type="datetime-local"> в ЛОКАЛЬНОМ времени. */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Значение <input type="datetime-local"> (локальное) → ISO. */
export function localInputToIso(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

export function isoDateOnly(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Сколько дней осталось до даты. null — если даты нет или она битая. */
export function daysLeft(iso?: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000)
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
