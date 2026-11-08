import type { Minor } from '../types'

/** Неразрывный пробел — разделитель разрядов. */
const NBSP = ' '

/**
 * Умножение на 100 с поправкой на двоичное представление.
 * `Math.round(1.005 * 100)` даёт 100 вместо 101, потому что 1.005 хранится
 * как 1.00499999999999989. Округляем до 10 знаков перед финальным round —
 * этого хватает, чтобы убрать артефакт, и мало, чтобы задеть реальные данные.
 */
function scaleToMinor(n: number): Minor {
  return Math.round(Number((n * 100).toFixed(10)))
}

/** "1234,56" | "1234.56" | 1234.56  →  123456 (копейки) */
export function toMinor(input: string | number): Minor {
  if (typeof input === 'number') return Number.isFinite(input) ? scaleToMinor(input) : 0
  // \s в JS включает и неразрывный пробел (U+00A0), который приходит из разрядки
  const clean = input.replace(/\s/g, '').replace(',', '.')
  if (!clean) return 0
  const n = Number(clean)
  if (!Number.isFinite(n)) return 0
  return scaleToMinor(n)
}

/** 123456 → 1234.56 (только для отображения, не для хранения) */
export function toMajor(m: Minor): number {
  return m / 100
}

export function sum(list: Minor[]): Minor {
  let s = 0
  for (const v of list) s += v
  return s
}

// ─────────────────────────────────────────────────────────────────────────────
// Ввод денег. Используется и полем MoneyInput, и экранным блоком цифр,
// поэтому формат во всём приложении один: 10 → 10, 1000 → 1 000.
// ─────────────────────────────────────────────────────────────────────────────

/** Оставляет только цифры и одну запятую, не больше двух знаков после неё. */
export function sanitizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(/\./g, ',')
  const [int, ...rest] = cleaned.split(',')
  const digits = int.replace(/\D/g, '').slice(0, 12)
  if (rest.length === 0) return digits
  return `${digits},${rest.join('').replace(/\D/g, '').slice(0, 2)}`
}

/** "1234567,8" → "1 234 567,8" (разряды разделены неразрывным пробелом). */
export function groupMoney(value: string): string {
  if (!value) return ''
  const [int, dec] = value.split(',')
  const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  return dec !== undefined ? `${grouped},${dec}` : grouped
}

/** Копейки → строка для поля ввода (без разрядки, с запятой). */
export function minorToInput(m: Minor | null | undefined): string {
  if (m == null) return ''
  const sign = m < 0 ? '-' : ''
  const abs = Math.abs(m)
  const rub = Math.floor(abs / 100)
  const kop = abs % 100
  return kop === 0 ? `${sign}${rub}` : `${sign}${rub},${String(kop).padStart(2, '0')}`
}
