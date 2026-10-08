import { useCallback, useEffect, useState } from 'react'
import { db } from '../db'
import { hasSupabase } from '../db/supabase'
import { syncNow } from '../db/sync'

export type SyncStatus = 'local' | 'online' | 'offline' | 'syncing' | 'pending' | 'error'

const AUTO_SYNC_MS = 60_000

export function useSync(enabled: boolean) {
  const [isOnline, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [dead, setDead] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  const refreshCounts = useCallback(async () => {
    const [p, d] = await Promise.all([
      db.syncQueue.where('dead').equals(0).count(),
      db.syncQueue.where('dead').equals(1).count(),
    ])
    setPending(p); setDead(d)
  }, [])

  const run = useCallback(async () => {
    if (!enabled || !hasSupabase) { await refreshCounts(); return }
    setSyncing(true)
    try {
      const r = await syncNow()
      setLastError(r.error && r.error !== 'offline' ? r.error : null)
    } finally {
      setSyncing(false)
      await refreshCounts()
    }
  }, [enabled, refreshCounts])

  // периодический флаш очереди — раньше синк запускался только на mount и online
  useEffect(() => {
    void refreshCounts()
    const counts = setInterval(refreshCounts, 4000)
    const auto = setInterval(() => { if (navigator.onLine) void run() }, AUTO_SYNC_MS)
    return () => { clearInterval(counts); clearInterval(auto) }
  }, [refreshCounts, run])

  useEffect(() => {
    const on = () => { setOnline(true); void run() }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [run])

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
