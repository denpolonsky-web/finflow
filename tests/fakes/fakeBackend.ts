import type { SyncBackend, PushOutcome, FetchPage } from '../../src/db/sync'

/**
 * Подставной сервер: in-memory таблицы + управляемые сбои.
 *
 * Нужен, чтобы самый опасный путь приложения — отправка изменений — проверялся
 * не только на живом проде. Поведение повторяет Supabase в том, что важно:
 * строки с `updated_at`, выборка «строго новее водяного знака» по возрастанию,
 * постраничность и soft-delete через `deleted_at`.
 */

export type FailMode =
  /** ответа нет вовсе: таймаут или брошенное исключение */
  | { kind: 'silent' }
  /** сервер ответил ошибкой: сеть отвалилась по дороге */
  | { kind: 'network'; message?: string }
  /** сервер отверг по содержимому: битый payload, RLS и т.п. */
  | { kind: 'reject'; message?: string }

export class FakeBackend implements SyncBackend {
  /** таблица → id строки → строка */
  readonly tables = new Map<string, Map<string, Record<string, unknown>>>()

  /** если задано — так ответит следующая запись (push), по одному разу на попытку */
  private writeFailures: FailMode[] = []
  /**
   * Сбои чтения — с привязкой к таблице. Без неё сбой садился на первую же
   * таблицу из PULL_ORDER (app_settings), а не на ту, что проверяет тест.
   */
  private readFailures: { mode: FailMode; table?: string }[] = []

  /** сколько раз сервер вообще трогали — чтобы ловить лишние обращения */
  writes = 0
  reads = 0
  /** из них пакетных запросов */
  batchWrites = 0

  /**
   * «Ядовитая» строка: сервер отвергает её по содержимому всегда. Пакет с такой
   * строкой отвергается ЦЕЛИКОМ — как в Postgres, где вставка атомарна.
   */
  poison: ((payload: Record<string, unknown>) => boolean) | null = null

  private static readonly REJECT: PushOutcome = { ok: false, message: 'invalid input syntax for type bigint' }

  /** Следующие `times` записей закончатся этим сбоем. */
  failWrites(mode: FailMode, times = 1) {
    for (let i = 0; i < times; i++) this.writeFailures.push(mode)
  }

  /** `table` — имя таблицы на сервере, например 'accounts'. Без него сбой сядет на любое чтение. */
  failReads(mode: FailMode, times = 1, table?: string) {
    for (let i = 0; i < times; i++) this.readFailures.push({ mode, table })
  }

  rows(table: string): Record<string, unknown>[] {
    return [...(this.tables.get(table)?.values() ?? [])]
  }

  /** Положить строку «со стороны другого устройства». */
  seed(table: string, row: Record<string, unknown>) {
    const t = this.tables.get(table) ?? new Map()
    t.set(String(row.id ?? '1'), row)
    this.tables.set(table, t)
  }

  private outcome(mode: FailMode | undefined): PushOutcome | null | 'ok' {
    if (!mode) return 'ok'
    if (mode.kind === 'silent') return null
    if (mode.kind === 'network') return { ok: false, message: mode.message ?? 'Failed to fetch' }
    return { ok: false, message: mode.message ?? 'invalid input syntax for type bigint' }
  }

  async upsert(table: string, payload: Record<string, unknown>, onConflict: 'id' | 'user_id'): Promise<PushOutcome | null> {
    this.writes++
    const res = this.outcome(this.writeFailures.shift())
    if (res !== 'ok') return res
    if (this.poison?.(payload)) return FakeBackend.REJECT

    this.store(table, payload, onConflict)
    return { ok: true }
  }

  private store(table: string, payload: Record<string, unknown>, onConflict: 'id' | 'user_id') {
    const t = this.tables.get(table) ?? new Map()
    // app_settings живут одной строкой на пользователя — ключа id у них нет
    const key = onConflict === 'user_id' ? 'singleton' : String(payload.id ?? '')
    t.set(key, { ...t.get(key), ...payload, id: payload.id ?? key })
    this.tables.set(table, t)
  }

  /** Пакетная вставка: либо все строки, либо ни одной. */
  async upsertMany(table: string, payloads: Record<string, unknown>[]): Promise<PushOutcome | null> {
    this.writes++
    this.batchWrites++
    const res = this.outcome(this.writeFailures.shift())
    if (res !== 'ok') return res
    if (this.poison && payloads.some(p => this.poison!(p))) return FakeBackend.REJECT

    for (const p of payloads) this.store(table, p, 'id')
    return { ok: true }
  }

  async softDeleteMany(table: string, ids: string[], now: string): Promise<PushOutcome | null> {
    this.writes++
    this.batchWrites++
    const res = this.outcome(this.writeFailures.shift())
    if (res !== 'ok') return res

    const t = this.tables.get(table)
    for (const id of ids) {
      const existing = t?.get(id)
      if (t && existing) t.set(id, { ...existing, deleted_at: now, updated_at: now })
    }
    return { ok: true }
  }

  async softDelete(table: string, id: string, now: string): Promise<PushOutcome | null> {
    this.writes++
    const res = this.outcome(this.writeFailures.shift())
    if (res !== 'ok') return res

    const t = this.tables.get(table)
    const existing = t?.get(id)
    // как в Postgres: update по несуществующей строке затрагивает 0 строк и НЕ ошибка
    if (t && existing) t.set(id, { ...existing, deleted_at: now, updated_at: now })
    return { ok: true }
  }

  async fetchSince(table: string, since: string, from: number, limit: number): Promise<FetchPage | null> {
    this.reads++
    const idx = this.readFailures.findIndex(f => !f.table || f.table === table)
    const mode = idx >= 0 ? this.readFailures.splice(idx, 1)[0].mode : undefined
    if (mode?.kind === 'silent') return null
    if (mode) return { error: mode.kind === 'network' ? (mode.message ?? 'Failed to fetch') : (mode.message ?? 'permission denied') }

    const all = [...(this.tables.get(table)?.values() ?? [])]
      .filter(r => String(r.updated_at ?? '') > since)
      .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))
    return { rows: all.slice(from, from + limit) }
  }
}

/** В Node нет navigator.onLine, а синк на него смотрит. */
export function pretendOnline() {
  const nav = globalThis.navigator as { onLine?: boolean } | undefined
  if (!nav) {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
  } else if (nav.onLine === undefined) {
    Object.defineProperty(nav, 'onLine', { value: true, configurable: true })
  }
}
