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
  profile: 'profiles',
}

const LOCAL_TABLE: Record<SyncEntity, string> = {
  account: 'accounts',
  transaction: 'transactions',
  posting: 'postings',
  goal: 'goals',
  budget: 'budgets',
  snapshot: 'snapshots',
  settings: 'settings',
  profile: 'profiles',
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

const PULL_ORDER: SyncEntity[] = ['settings', 'profile', 'account', 'goal', 'budget', 'transaction', 'posting', 'snapshot']
const PAGE = 1000

/**
 * Инкрементальный pull по updated_at.
 *
 * Водяной знак (watermark) теперь СВОЙ У КАЖДОЙ ТАБЛИЦЫ и сдвигается только если
 * таблица прокачалась до конца без ошибок. Раньше знак был общий и записывался
 * безусловно: если postings отвалились по таймауту, а transactions прошли,
 * знак уезжал вперёд — и эти postings не приезжали на устройство НИКОГДА.
 * Это и есть главный сценарий «на телефоне операции есть, на ноуте нет».
 */
export interface PullReport { pulled: number; error?: string }

const WM_PREFIX = 'pullAt:'

async function watermark(entity: SyncEntity): Promise<string> {
  // старый общий ключ используем как стартовое значение, чтобы не перекачивать всё заново
  return (await getMeta(WM_PREFIX + entity))
    ?? (await getMeta('lastPullAt'))
    ?? '1970-01-01T00:00:00.000Z'
}

export async function pull(): Promise<PullReport> {
  if (!hasSupabase || !navigator.onLine) return { pulled: 0 }
  const blocked = await pendingIds()
  let total = 0
  const errors: string[] = []

  for (const entity of PULL_ORDER) {
    const remote = TABLE[entity]
    const local = LOCAL_TABLE[entity]
    const since = await watermark(entity)
    let newest = since
    let from = 0
    let clean = true

    for (;;) {
      const query = supabase!.from(remote).select('*').gt('updated_at', since)
        .order('updated_at', { ascending: true }).range(from, from + PAGE - 1)
      const res = await withTimeout(
        Promise.resolve(query) as Promise<{ data: unknown; error: { message: string } | null }>,
        20_000, `pull ${remote}`,
      )
      if (!res) { console.warn('[pull] таймаут на', remote); errors.push(`${remote}: таймаут`); clean = false; break }
      if (res.error) { console.error('[pull]', remote, res.error.message); errors.push(`${remote}: ${res.error.message}`); clean = false; break }

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

        // у настроек локальный ключ 1, а в очереди он лежит под строкой 'settings' —
        // без этого несохранённые настройки затирались приходящими из облака
        const queueKey = entity === 'settings' ? 'settings' : String(id)
        if (blocked.has(queueKey)) continue              // локально есть неотправленные правки

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

    // сдвигаем знак ТОЛЬКО если таблица дочитана целиком: повторно перечитать
    // страницу дёшево и идемпотентно, потерять строку — нет
    if (clean && newest > since) await setMeta(WM_PREFIX + entity, newest)
  }

  return { pulled: total, error: errors.length ? errors.join('; ') : undefined }
}

/** Полная отправка всего локального состояния — после первого входа на устройстве. */
export async function pushAll(): Promise<number> {
  const [accounts, transactions, postings, goals, budgets, snapshots, settings, profiles] = await Promise.all([
    db.accounts.toArray(), db.transactions.toArray(), db.postings.toArray(),
    db.goals.toArray(), db.budgets.toArray(), db.snapshots.toArray(), db.settings.get(1),
    db.profiles.toArray(),
  ])
  let n = 0
  for (const pr of profiles) { await enqueue('profile', pr.id, 'upsert', pr); n++ }
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
    const r = await pull()                              // затем забираем чужое
    // ошибку pull'а больше не глотаем: иначе статус «online» врал,
    // хотя половина таблиц не приехала
    return { ...p, pulled: r.pulled, error: r.error }
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
