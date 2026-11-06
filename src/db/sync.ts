import { db, getMeta, setMeta, DEFAULT_SETTINGS } from './index'
import { supabase, hasSupabase, withTimeout } from './supabase'
import { isNetworkFailure } from './cloudConfig'
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
  category: 'categories',
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
  category: 'categories',
}

const MAX_RETRIES = 5

/**
 * Сколько сетевых сбоев подряд считаем «связи нет» и прекращаем круг отправки.
 * Без этого ограничения очередь из сотни записей на плохой сети держала статус
 * «Синхронизация…» десятки минут: каждый элемент ждал свой таймаут в 12 секунд.
 */
const NET_FAILURE_LIMIT = 3

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

/** Результат одной попытки отправки. Успех и ошибка различимы по полю `ok`. */
export type PushOutcome = { ok: true } | { ok: false; message: string }

/** Страница, прочитанная с сервера. `null` — ответа не было (таймаут или исключение). */
export type FetchPage = { rows: Record<string, unknown>[] } | { error: string }

/**
 * Всё, что синхронизации нужно от сервера. Специфика supabase-js живёт
 * в одном адаптере ниже и больше нигде.
 *
 * Ради этого интерфейса и сделано разделение: самый опасный путь приложения —
 * отправка изменений — иначе проверялся бы только на живом проде. С ним push
 * и pull гоняются в тестах целиком, вместе с таймаутами, отказами сервера
 * и обрывами связи.
 *
 * Реализация ОБЯЗАНА возвращать `null` вместо броска исключения, когда ответа
 * не было: различение «не ответил» и «отказал» — основа защиты от потери данных.
 */
export interface SyncBackend {
  upsert(table: string, payload: Record<string, unknown>, onConflict: 'id' | 'user_id'): Promise<PushOutcome | null>
  softDelete(table: string, id: string, now: string): Promise<PushOutcome | null>
  fetchSince(table: string, since: string, from: number, limit: number): Promise<FetchPage | null>
}

/** Боевой бэкенд поверх supabase-js. Таймауты живут здесь же. */
export function supabaseBackend(): SyncBackend {
  return {
    // Promise.resolve вокруг запроса обязателен: конструктор запроса supabase-js —
    // это thenable, а не настоящий Promise, и withTimeout его не принимает
    upsert: (table, payload, onConflict) => withTimeout(
      Promise.resolve(supabase!.from(table).upsert(payload, { onConflict }))
        .then(({ error }) => (error ? { ok: false as const, message: error.message } : { ok: true as const })),
      12_000, `push ${table}`,
    ),

    softDelete: (table, id, now) => withTimeout(
      Promise.resolve(supabase!.from(table).update({ deleted_at: now, updated_at: now }).eq('id', id))
        .then(({ error }) => (error ? { ok: false as const, message: error.message } : { ok: true as const })),
      12_000, `delete ${table}`,
    ),

    fetchSince: (table, since, from, limit) => withTimeout(
      Promise.resolve(
        supabase!.from(table).select('*').gt('updated_at', since)
          .order('updated_at', { ascending: true }).range(from, from + limit - 1),
      ).then(({ data, error }: { data: unknown; error: { message: string } | null }) =>
        (error ? { error: error.message } : { rows: (data ?? []) as Record<string, unknown>[] })),
      20_000, `pull ${table}`,
    ),
  }
}

/**
 * Удаление отправляется как soft-delete (deleted_at), а не DELETE —
 * иначе другое устройство никогда не узнает, что запись исчезла, и вернёт её
 * обратно ближайшим pull'ом.
 */
async function pushItem(backend: SyncBackend, item: SyncQueueItem): Promise<PushOutcome | null> {
  const table = TABLE[item.entityType]
  const now = new Date().toISOString()

  if (item.operation === 'delete') {
    return backend.softDelete(table, item.entityId, now)
  }

  const payload = keysToSnake({ ...(item.payload as Record<string, unknown>), updatedAt: now })
  // settings живут по одной строке на пользователя — ключ не id, а user_id (ставит сервер)
  if (item.entityType === 'settings') delete payload.id

  return backend.upsert(table, payload, item.entityType === 'settings' ? 'user_id' : 'id')
}

export type PushDecision =
  /** доехало — запись можно убирать из очереди */
  | { kind: 'sent' }
  /** связь подвела — запись ОСТАЁТСЯ в очереди и не приближается к dead */
  | { kind: 'retry'; message: string }
  /** сервер отказал по содержимому — вот это считаем в MAX_RETRIES */
  | { kind: 'rejected'; message: string }

/**
 * Решение по результату попытки отправки. Чистая функция — покрыта тестами.
 *
 * Здесь закрыт баг с тихой потерей данных. `pushItem` раньше возвращал `null`
 * при успехе, а `withTimeout` возвращает тот же `null` и при таймауте, и при
 * брошенном исключении — ветка «успех» удаляла запись из очереди. Изменение
 * не уезжало в облако НИКОГДА, а интерфейс показывал «всё синхронизировано».
 * Поэтому `null` здесь — всегда неудача, и только она.
 *
 * Второе важное различие: сетевой сбой не вина записи. Если считать его в
 * MAX_RETRIES, плохая связь пометит dead'ом нормальные изменения, и они
 * потеряются уже окончательно. В dead уезжает только то, что сервер отверг
 * по сути (битый payload, нарушение RLS и т.п.).
 */
export function pushDecision(res: PushOutcome | null): PushDecision {
  if (res === null) return { kind: 'retry', message: 'сервер не ответил (таймаут или сбой сети)' }
  if (res.ok) return { kind: 'sent' }
  if (isNetworkFailure(res.message)) return { kind: 'retry', message: res.message }
  return { kind: 'rejected', message: res.message }
}

export interface PushResult {
  pushed: number
  failed: number
  dead: number
  /** заполнено, если круг прерван из-за отсутствия связи — записи остались в очереди */
  netError?: string
}

export async function push(backend: SyncBackend = supabaseBackend()): Promise<PushResult> {
  let pushed = 0, failed = 0, dead = 0, netFailures = 0
  let lastNetError: string | undefined

  const items = await db.syncQueue.where('dead').equals(0).sortBy('createdAt')
  for (const item of items) {
    const res = await pushItem(backend, item)
    const decision = pushDecision(res)

    if (decision.kind === 'sent') {
      await db.syncQueue.delete(item.id)
      pushed++
      netFailures = 0
      continue
    }

    failed++

    if (decision.kind === 'retry') {
      // Запись остаётся в очереди. retryCount намеренно НЕ растим: это сбой связи,
      // а не плохая запись — иначе пара обрывов похоронит нормальные изменения.
      await db.syncQueue.update(item.id, { lastError: decision.message })
      netFailures++
      lastNetError = decision.message
      if (netFailures >= NET_FAILURE_LIMIT) {
        console.warn('[sync] связи нет — круг отправки прерван, записи остались в очереди')
        return { pushed, failed, dead, netError: decision.message }
      }
      continue
    }

    // «ядовитый» элемент больше не ретраим — иначе он навсегда заблокирует счётчик
    const retryCount = item.retryCount + 1
    if (retryCount >= MAX_RETRIES) {
      await db.syncQueue.update(item.id, { retryCount, lastError: decision.message, dead: 1 })
      dead++
      console.error('[sync] элемент помечен dead:', item.entityType, item.entityId, decision.message)
    } else {
      await db.syncQueue.update(item.id, { retryCount, lastError: decision.message })
    }
  }

  /**
   * Связь подвела и НИ ОДНА запись не ушла — значит сервер недоступен, и идти
   * дальше в pull незачем: там ещё восемь таблиц по своему таймауту.
   *
   * Порога `NET_FAILURE_LIMIT` для этого мало: он прерывает длинную очередь
   * на третьем сбое подряд, но при одной-двух записях не срабатывает вовсе —
   * и «Синхронизация…» всё равно висела минутами на pull'е.
   */
  if (netFailures > 0 && pushed === 0) {
    return { pushed, failed, dead, netError: lastNetError ?? 'связь с сервером потеряна' }
  }
  return { pushed, failed, dead }
}

// ─────────────────────────────────────────────────────────────────────────────
// PULL
// ─────────────────────────────────────────────────────────────────────────────

// категории тянем рано: от них зависят подписи во всех разрезах
const PULL_ORDER: SyncEntity[] = ['settings', 'profile', 'category', 'account', 'goal', 'budget', 'transaction', 'posting', 'snapshot']
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

export async function pull(backend: SyncBackend = supabaseBackend()): Promise<PullReport> {
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
    /**
     * Встретили строку, которую не применили из-за неотправленных локальных
     * правок — дальше водяной знак не двигаем. Строки приходят по возрастанию
     * updated_at, поэтому первая такая задаёт потолок. Без этого знак уезжал
     * вперёд, а если элемент очереди потом умирал (dead=1), он перестаёт
     * блокировать pull — и серверная версия не приезжала уже никогда.
     */
    let frozen = false

    for (;;) {
      const res = await backend.fetchSince(remote, since, from, PAGE)
      if (!res) { console.warn('[pull] таймаут на', remote); errors.push(`${remote}: таймаут`); clean = false; break }
      if ('error' in res) { console.error('[pull]', remote, res.error); errors.push(`${remote}: ${res.error}`); clean = false; break }

      const rows = res.rows
      if (!rows.length) break

      const table = db.table(local)
      const toPut: Record<string, unknown>[] = []
      const toDelete: string[] = []

      for (const raw of rows) {
        const updatedAt = String(raw.updated_at ?? '')

        const row = keysToCamel(raw)
        const id = entity === 'settings' ? 1 : String(row.id ?? '')
        delete row.userId

        if (entity === 'settings') row.id = 1

        // у настроек локальный ключ 1, а в очереди он лежит под строкой 'settings' —
        // без этого несохранённые настройки затирались приходящими из облака
        const queueKey = entity === 'settings' ? 'settings' : String(id)
        if (blocked.has(queueKey)) {                     // локально есть неотправленные правки
          frozen = true
          continue
        }

        if (!frozen && updatedAt > newest) newest = updatedAt

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
  const [accounts, transactions, postings, goals, budgets, snapshots, settings, profiles, categories] = await Promise.all([
    db.accounts.toArray(), db.transactions.toArray(), db.postings.toArray(),
    db.goals.toArray(), db.budgets.toArray(), db.snapshots.toArray(), db.settings.get(1),
    db.profiles.toArray(), db.categories.toArray(),
  ])
  let n = 0
  for (const pr of profiles) { await enqueue('profile', pr.id, 'upsert', pr); n++ }
  for (const c of categories) { await enqueue('category', c.id, 'upsert', c); n++ }
  for (const a of accounts) { await enqueue('account', a.id, 'upsert', a); n++ }
  for (const g of goals) { await enqueue('goal', g.id, 'upsert', g); n++ }
  for (const b of budgets) { await enqueue('budget', b.id, 'upsert', b); n++ }
  for (const t of transactions) { await enqueue('transaction', t.id, 'upsert', t); n++ }
  for (const p of postings) { await enqueue('posting', p.id, 'upsert', p); n++ }
  for (const s of snapshots) { await enqueue('snapshot', s.id, 'upsert', s); n++ }
  if (settings) { await enqueue('settings', 'settings', 'upsert', settings); n++ }
  return n
}

/**
 * Проверка «есть ли куда синхронизироваться» живёт здесь, а не внутри push/pull:
 * те работают с любым бэкендом, и сам факт переданного бэкенда означает,
 * что отправлять есть куда. Благодаря этому они гоняются в тестах.
 */
export async function syncNow(): Promise<SyncReport> {
  if (!hasSupabase) return { pushed: 0, pulled: 0, failed: 0, dead: 0 }
  if (!navigator.onLine) return { pushed: 0, pulled: 0, failed: 0, dead: 0, error: 'offline' }
  try {
    const backend = supabaseBackend()
    const { pushed, failed, dead, netError } = await push(backend)   // сначала отдаём своё
    // Связи нет — не тратим ещё восемь таймаутов по 20 секунд на pull.
    // Раньше именно это держало «Синхронизация…» минутами.
    if (netError) return { pushed, pulled: 0, failed, dead, error: netError }

    const r = await pull(backend)                       // затем забираем чужое
    // ошибку pull'а больше не глотаем: иначе статус «online» врал,
    // хотя половина таблиц не приехала
    return { pushed, pulled: r.pulled, failed, dead, error: r.error }
  } catch (e) {
    console.error('[sync]', e)
    return { pushed: 0, pulled: 0, failed: 0, dead: 0, error: String(e) }
  }
}

/** Первый вход на устройстве: тянем облако, если локально пусто — иначе заливаем своё. */
export async function bootstrapSync(): Promise<void> {
  if (!hasSupabase || !navigator.onLine) return
  const backend = supabaseBackend()
  await pull(backend)
  const done = await getMeta('initialPushDone')
  if (!done) {
    const localCount = await db.transactions.count() + await db.accounts.count()
    if (localCount > 0) await pushAll()
    await setMeta('initialPushDone', '1')
  }
  await push(backend)
  if (!(await db.settings.get(1))) {
    await db.settings.put({ ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() })
  }
}
