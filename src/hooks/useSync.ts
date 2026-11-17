import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { hasSupabase } from '../db/supabase'
import { syncNow } from '../db/sync'

export type SyncStatus = 'local' | 'online' | 'offline' | 'syncing' | 'pending' | 'error'

/** Как часто проверяем очередь и пробуем отправить своё. */
const AUTO_SYNC_MS = 60_000
/**
 * Как часто по таймеру тянем чужое. Отправка идёт каждую минуту и сразу после
 * правки, а чтение девяти таблиц раз в минуту — лишняя работа: на устройстве
 * обычно один человек, и чужие изменения появляются редко. Плюс pull делается
 * при возврате в приложение и по кнопке — там, где свежие данные и нужны.
 */
const AUTO_PULL_MS = 5 * 60_000
/** Возврат в приложение или появление сети: тянем, если прошлый pull старше этого. */
const WAKE_PULL_MS = 30_000
/** Через сколько после локальной правки отправляем её, не дожидаясь таймера. */
const PUSH_DEBOUNCE_MS = 1_500
/** Фоновый круг дольше этого перестаёт быть незаметным — показываем плашку. */
const SLOW_ROUND_MS = 6_000
/** Очередь, не опустевшая за это время, — уже не «сейчас уедет», а повод показать. */
const STALE_PENDING_MS = 20_000

type Reason = 'manual' | 'wake' | 'tick' | 'edit'

const PULL_GAP: Record<Reason, number> = {
  manual: 0,                 // человек нажал кнопку — тянем всегда
  wake: WAKE_PULL_MS,
  tick: AUTO_PULL_MS,
  edit: AUTO_PULL_MS,
}

export function useSync(enabled: boolean) {
  const [isOnline, setOnline] = useState(navigator.onLine)
  /**
   * Плашка «Синхронизация…» — только для кругов, которые человеку стоит видеть:
   * запущенных кнопкой или затянувшихся. Обычный фоновый круг занимает доли
   * секунды и раньше мигал плашкой каждую минуту — «синхронизация висит
   * постоянно», хотя отправлять было нечего.
   */
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [stalePending, setStalePending] = useState(false)

  /**
   * Счётчики очереди берём через liveQuery: Dexie сам уведомляет об изменениях.
   * Раньше их опрашивал setInterval каждые 4 секунды всё время жизни приложения —
   * постоянные запросы к IndexedDB ради чисел, которые и так меняются по событию.
   */
  const pending = useLiveQuery(() => db.syncQueue.where('dead').equals(0).count(), [], 0)
  const dead = useLiveQuery(() => db.syncQueue.where('dead').equals(1).count(), [], 0)

  /**
   * Круг синхронизации уже идёт. Без этой защиты автосинк раз в минуту
   * стартовал поверх незакончившегося круга (а он на плохой сети длится
   * дольше минуты) — запросы наслаивались, и статус «Синхронизация…»
   * не гас никогда.
   */
  const running = useRef(false)

  const run = useCallback(async (reason: Reason = 'manual') => {
    if (!enabled || !hasSupabase) return
    if (running.current) return
    running.current = true
    const manual = reason === 'manual'
    if (manual) setSyncing(true)
    // фоновый круг показываем, только если он затянулся
    const slow = manual ? null : setTimeout(() => setSyncing(true), SLOW_ROUND_MS)
    try {
      const r = await syncNow({ minPullGapMs: PULL_GAP[reason] })
      // пропущенный круг (ещё идёт стартовый) ничего не говорит об ошибках
      if (!r.skipped) setLastError(r.error && r.error !== 'offline' ? r.error : null)
    } finally {
      if (slow) clearTimeout(slow)
      running.current = false
      setSyncing(false)
    }
  }, [enabled])

  // периодический флаш очереди — раньше синк запускался только на mount и online
  useEffect(() => {
    const auto = setInterval(() => { if (navigator.onLine) void run('tick') }, AUTO_SYNC_MS)
    return () => clearInterval(auto)
  }, [run])

  useEffect(() => {
    const on = () => { setOnline(true); void run('wake') }
    const off = () => setOnline(false)
    // вернулись в приложение — там могли появиться изменения с другого устройства
    const visible = () => { if (document.visibilityState === 'visible' && navigator.onLine) void run('wake') }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [run])

  // первый круг синхронизации при монтировании и при смене enabled
  // eslint-disable-next-line react-hooks/set-state-in-effect -- run асинхронный: setState происходит после await, а не синхронно в теле эффекта
  useEffect(() => { void run('wake') }, [run])

  /**
   * Локальная правка уезжает сразу, а не ждёт до минуты следующего таймера.
   *
   * Срабатывает только на РОСТ очереди — то есть на новую правку. На убывание
   * реагировать нельзя: отвергнутая сервером запись остаётся в очереди, и круг,
   * перезапускаемый каждым её соседом, прогнал бы все пять попыток за секунды
   * и увёл бы её в dead-letter раньше, чем успел бы, например, обновиться токен.
   * Повторы отвергнутого и не доехавшего делает минутный таймер, как и раньше.
   */
  const hasPending = pending > 0
  const prevPending = useRef(0)
  useEffect(() => {
    const grew = pending > prevPending.current
    prevPending.current = pending
    if (!grew) return
    const t = setTimeout(() => { if (navigator.onLine) void run('edit') }, PUSH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [pending, run])

  /**
   * «Ожидает отправки» показываем плашкой, только если очередь не опустела
   * за разумное время. Иначе плашка мигала после каждой заведённой операции,
   * хотя та уезжала через полторы секунды. Оба setState — в колбэках таймера,
   * а не в теле эффекта.
   */
  useEffect(() => {
    const t = setTimeout(() => setStalePending(hasPending), hasPending ? STALE_PENDING_MS : 0)
    return () => clearTimeout(t)
  }, [hasPending])

  const status: SyncStatus =
    !hasSupabase || !enabled ? 'local'
      : !isOnline ? 'offline'
        : syncing ? 'syncing'
          : dead > 0 || lastError ? 'error'
            : pending > 0 ? 'pending'
              : 'online'

  /** То же, но для плашки над навигацией: свежую очередь она не показывает. */
  const banner: SyncStatus = status === 'pending' && !stalePending ? 'online' : status

  const manualSync = useCallback(() => { void run('manual') }, [run])

  return { status, banner, pending, dead, lastError, isOnline, syncNow: manualSync }
}
