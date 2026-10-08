import { db, getMeta, setMeta, DEFAULT_SETTINGS } from './index'
import { supabase, hasSupabase, withTimeout } from './supabase'
import { pendingIds, enqueue } from './queue'
import type { SyncEntity, SyncQueueItem } from '../types'

const TABLE: Record<SyncEntity, string> = {
  account: 'accounts',
  transaction: 'transactions',
  posting: 'postings',
  goal: 'goals',
  budget: 'budgets',
  snapshot: 'balance_snapshots',
  settings: 'app_settings',
}

const LOCAL_TABLE: Record<SyncEntity, string> = {
  account: 'accounts',
  transaction: 'transactions',
  posting: 'postings',
  goal: 'goals',
  budget: 'budgets',
  snapshot: 'snapshots',
  settings: 'settings',
}

const MAX_RETRIES = 5

// ─────────────────────────────────────────────────────────────────────────────
// camelCase ↔ snake_case
// ─────────────────────────────────────────────────────────────────────────────

const toSnake = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
const toCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

function keysToSnake(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) out[toSnake(k)] = v
  return out
}

function keysToCamel(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) out[toCamel(k)] = v
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncReport {
  pushed: number
  pulled: number
  failed: number
  dead: number
  error?: string
}

/**
 * Удаление отправляется как soft-delete (deleted_at), а не DELETE —
 * иначе другое устройство никогда не узнает, что запись исчезла, и вернёт её
 * обратно ближайшим pull'ом.
 */
async function pushItem(item: SyncQueueItem): Promise<string | null> {
  const table = TABLE[item.entityType]
  const now = new Date().toISOString()

  if (item.operation === 'delete') {
    const { error } = await supabase!
      .from(table)
      .update({ deleted_at: now, updated_at: now })
      .eq('id', item.entityId)
    return error ? error.message : null
  }

  const payload = keysToSnake({ ...(item.payload as Record<string, unknown>), updatedAt: now })
  // settings живут по одной строке на пользователя — ключ не id, а user_id (ставит сервер)
  if (item.entityType === 'settings') delete payload.id

  const q = item.entityType === 'settings'
    ? supabase!.from(table).upsert(payload, { onConflict: 'user_id' })
    : supabase!.from(table).upsert(payload, { onConflict: 'id' })

  const { error } = await q
  return error ? error.message : null
}

export async function push(): Promise<{ pushed: number; failed: number; dead: number }> {
  let pushed = 0, failed = 0, dead = 0
  if (!hasSupabase || !navigator.onLine) return { pushed, failed, dead }

  const items = await db.syncQueue.where('dead').equals(0).sortBy('createdAt')
  for (const item of items) {
    const err = await withTimeout(pushItem(item), 12_000, `push ${item.entityType}`)
    if (err === null) {
      await db.syncQueue.delete(item.id)
      pushed++
      continue
    }
    // null от withTimeout = таймаут, строка = ошибка от сервера
    const message = err ?? 'timeout'
    const retryCount = item.retryCount + 1
    failed++
    if (retryCount >= MAX_RETRIES) {
      // «ядовитый» элемент больше не ретраим — иначе он навсегда заблокирует счётчик
      await db.syncQueue.update(item.id, { retryCount, lastError: message, dead: 1 })
      dead++
      console.error('[sync] элемент помечен dead:', item.entityType, item.entityId, message)
    } else {
      await db.syncQueue.update(item.id, { retryCount, lastError: message })
    }
  }
  return { pushed, failed, dead }
}

// ─────────────────────────────────────────────────────────────────────────────
// PULL
// ─────────────────────────────────────────────────────────────────────────────

const PULL_ORDER: SyncEntity[] = ['settings', 'account', 'goal', 'budget', 'transaction', 'posting', 'snapshot']
const PAGE = 1000

/**
 * Инкрементальный pull по updated_at. Три принципиальных отличия от прошлой версии:
 *  1. не `bulkPut` вслепую — локальная запись не перезаписывается, если она свежее
 *     или если по ней есть неотправленные изменения;
 *  2. приходят и удалённые строки (deleted_at) — значит удаление доезжает;
 *  3. нет лимита 500 — страницы идут, пока не кончатся.
 */
export async function pull(): Promise<number> {
  if (!hasSupabase || !navigator.onLine) return 0
  const since = (await getMeta('lastPullAt')) ?? '1970-01-01T00:00:00.000Z'
  const blocked = await pendingIds()
  let total = 0
  let newest = since

  for (const entity of PULL_ORDER) {
    const remote = TABLE[entity]
    const local = LOCAL_TABLE[entity]
    let from = 0

    for (;;) {
      const query = supabase!.from(remote).select('*').gt('updated_at', since)
        .order('updated_at', { ascending: true }).range(from, from + PAGE - 1)
      const res = await withTimeout(
        Promise.resolve(query) as Promise<{ data: unknown; error: { message: string } | null }>,
        20_000, `pull ${remote}`,
      )
      if (!res) { console.warn('[pull] таймаут на', remote); break }
      if (res.error) { console.error('[pull]', remote, res.error.message); break }

      const rows = (res.data ?? []) as Record<string, unknown>[]
      if (!rows.length) break

      const table = db.table(local)
      const toPut: Record<string, unknown>[] = []
      const toDelete: string[] = []

      for (const raw of rows) {
        const updatedAt = String(raw.updated_at ?? '')
        if (updatedAt > newest) newest = updatedAt

        const row = keysToCamel(raw)
        const id = entity === 'settings' ? 1 : String(row.id ?? '')
        delete row.userId

        if (entity === 'settings') row.id = 1

        if (blocked.has(String(id))) continue           // локально есть неотправленные правки

        if (row.deletedAt) { toDelete.push(String(id)); continue }

        const existing = await table.get(id as never) as Record<string, unknown> | undefined
        if (existing && typeof existing.updatedAt === 'string' && existing.updatedAt > updatedAt) {
          continue                                       // локальная версия свежее
        }
        toPut.push(row)
      }

      if (toPut.length) await table.bulkPut(toPut as never[])
      if (toDelete.length) await table.bulkDelete(toDelete as never[])
      total += toPut.length + toDelete.length

      if (rows.length < PAGE) break
      from += PAGE
    }
  }

  await setMeta('lastPullAt', newest)
  return total
}

/** Полная отправка всего локального состояния — после первого входа на устройстве. */
export async function pushAll(): Promise<number> {
  const [accounts, transactions, postings, goals, budgets, snapshots, settings] = await Promise.all([
    db.accounts.toArray(), db.transactions.toArray(), db.postings.toArray(),
    db.goals.toArray(), db.budgets.toArray(), db.snapshots.toArray(), db.settings.get(1),
  ])
  let n = 0
  for (const a of accounts) { await enqueue('account', a.id, 'upsert', a); n++ }
  for (const g of goals) { await enqueue('goal', g.id, 'upsert', g); n++ }
  for (const b of budgets) { await enqueue('budget', b.id, 'upsert', b); n++ }
  for (const t of transactions) { await enqueue('transaction', t.id, 'upsert', t); n++ }
  for (const p of postings) { await enqueue('posting', p.id, 'upsert', p); n++ }
  for (const s of snapshots) { await enqueue('snapshot', s.id, 'upsert', s); n++ }
  if (settings) { await enqueue('settings', 'settings', 'upsert', settings); n++ }
  return n
}

export async function syncNow(): Promise<SyncReport> {
  if (!hasSupabase) return { pushed: 0, pulled: 0, failed: 0, dead: 0 }
  if (!navigator.onLine) return { pushed: 0, pulled: 0, failed: 0, dead: 0, error: 'offline' }
  try {
    const p = await push()                              // сначала отдаём своё
    const pulled = await pull()                         // затем забираем чужое
    return { ...p, pulled }
  } catch (e) {
    console.error('[sync]', e)
    return { pushed: 0, pulled: 0, failed: 0, dead: 0, error: String(e) }
  }
}

/** Первый вход на устройстве: тянем облако, если локально пусто — иначе заливаем своё. */
export async function bootstrapSync(): Promise<void> {
  if (!hasSupabase || !navigator.onLine) return
  await pull()
  const done = await getMeta('initialPushDone')
  if (!done) {
    const localCount = await db.transactions.count() + await db.accounts.count()
    if (localCount > 0) await pushAll()
    await setMeta('initialPushDone', '1')
  }
  await push()
  if (!(await db.settings.get(1))) {
    await db.settings.put({ ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() })
  }
}
