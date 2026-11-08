import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { hasSupabase } from '../db/supabase'
import { syncNow } from '../db/sync'

export type SyncStatus = 'local' | 'online' | 'offline' | 'syncing' | 'pending' | 'error'

const AUTO_SYNC_MS = 60_000

export function useSync(enabled: boolean) {
  const [isOnline, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

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

  const run = useCallback(async () => {
    if (!enabled || !hasSupabase) return
    if (running.current) return
    running.current = true
    setSyncing(true)
    try {
      const r = await syncNow()
      setLastError(r.error && r.error !== 'offline' ? r.error : null)
    } finally {
      running.current = false
      setSyncing(false)
    }
  }, [enabled])

  // периодический флаш очереди — раньше синк запускался только на mount и online
  useEffect(() => {
    const auto = setInterval(() => { if (navigator.onLine) void run() }, AUTO_SYNC_MS)
    return () => clearInterval(auto)
  }, [run])

  useEffect(() => {
    const on = () => { setOnline(true); void run() }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [run])

  // первый круг синхронизации при монтировании и при смене enabled
  useEffect(() => { void run() }, [run])

  const status: SyncStatus =
    !hasSupabase || !enabled ? 'local'
      : !isOnline ? 'offline'
        : syncing ? 'syncing'
          : dead > 0 || lastError ? 'error'
            : pending > 0 ? 'pending'
              : 'online'

  return { status, pending, dead, lastError, isOnline, syncNow: run }
}
