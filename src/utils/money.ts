import type { Minor } from '../types'

/** "1234,56" | "1234.56" | 1234.56  →  123456 (копейки) */
export function toMinor(input: string | number): Minor {
  if (typeof input === 'number') return Math.round(input * 100)
  const clean = input.replace(/\s/g, '').replace(',', '.')
  if (!clean) return 0
  const n = Number(clean)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
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
