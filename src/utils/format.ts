import { format, isToday, isYesterday, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { Period } from '../types'

export function formatMoney(amount: number, compact = false): string {
  if (compact && Math.abs(amount) >= 1_000_000) {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency', currency: 'RUB',
      notation: 'compact', maximumFractionDigits: 1,
    }).format(amount)
  }
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount)
}

export function formatNumber(amount: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(amount))
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isToday(d)) return 'Сегодня'
  if (isYesterday(d)) return 'Вчера'
  return format(d, 'd MMMM yyyy', { locale: ru })
}

export function formatTime(iso: string): string {
  return format(new Date(iso), 'HH:mm')
}

export function formatDateShort(iso: string): string {
  return format(new Date(iso), 'd MMM', { locale: ru })
}

export function getPeriodRange(period: Period, customFrom?: Date, customTo?: Date): { from: Date; to: Date } {
  const now = new Date()
  switch (period) {
    case 'week':    return { from: startOfWeek(now, { weekStartsOn: 1 }), to: now }
    case 'month':   return { from: startOfMonth(now), to: now }
    case 'quarter': return { from: startOfQuarter(now), to: now }
    case 'year':    return { from: startOfYear(now), to: now }
    case 'custom':  return { from: customFrom ?? startOfMonth(now), to: customTo ?? now }
  }
}
