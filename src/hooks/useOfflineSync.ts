import { useEffect, useState } from 'react'
import { db } from '../db'
import { supabase, hasSupabase } from '../db/supabase'
import { registerDevice } from '../db/deviceToken'

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'pending'

function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, string> = {
    categoryId:    'category_id',
    cardId:        'card_id',
    toCardId:      'to_card_id',
    createdAt:     'created_at',
    updatedAt:     'updated_at',
    syncedAt:      'synced_at',
    goalId:        'goal_id',
    lastFour:      'last_four',
    targetAmount:  'target_amount',
    currentAmount: 'current_amount',
    isArchived:    'is_archived',
    completedAt:   'completed_at',
    userName:      'user_name',
    dailyLimit:    'daily_limit',
    categoryLimits:'category_limits',
    interestRate:  'interest_rate',
    expectedDate:  'expected_date',
    expectedAmount:'expected_amount',
    isActive:      'is_active',
  }
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    result[map[k] ?? k] = v
  }
  return result
}

async function runSync(): Promise<void> {
  if (!hasSupabase || !navigator.onLine) return
  const items = await db.syncQueue.orderBy('createdAt').toArray()
  if (!items.length) return
  console.log('[Sync] items:', items.length)

  for (const item of items) {
    const table = item.entityType === 'transaction' ? 'transactions'
      : item.entityType === 'goal'    ? 'goals'
      : item.entityType === 'card'    ? 'cards'
      : item.entityType === 'deposit' ? 'deposits'
      : null
    if (!table) { await db.syncQueue.delete(item.id); continue }

    try {
      if (item.operation === 'delete') {
        const { error } = await supabase!.from(table).delete().eq('id', item.entityId)
        if (error) { console.error('[Sync] delete error:', error); continue }
      } else {
        const payload = toSnakeCase(item.payload as Record<string, unknown>)
        const { error } = await supabase!.from(table).upsert(payload)
        if (error) { console.error('[Sync] upsert error:', error); continue }
      }
      await db.syncQueue.delete(item.id)
    } catch (e) {
      console.error('[Sync] exception:', e)
    }
  }
  console.log('[Sync] done ✓')
}

export function useOfflineSync() {
  const [isOnline,     setIsOnline]     = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [isSyncing,    setIsSyncing]    = useState(false)

  async function syncAndRefresh() {
    setIsSyncing(true)
    await runSync()
    const count = await db.syncQueue.count()
    setPendingCount(count)
    setIsSyncing(false)
  }

  useEffect(() => {
    db.syncQueue.count().then(setPendingCount)
    const t = setInterval(() => db.syncQueue.count().then(setPendingCount), 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const on = () => { setIsOnline(true); registerDevice(); syncAndRefresh() }
    const off = () => setIsOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => {
    registerDevice()
    syncAndRefresh()
  }, [])

  const status: SyncStatus = !isOnline ? 'offline'
    : isSyncing        ? 'syncing'
    : pendingCount > 0 ? 'pending'
    : 'online'

  return { isOnline, pendingCount, isSyncing, status, attemptSync: syncAndRefresh, hasSupabase }
}
