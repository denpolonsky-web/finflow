import { v4 as uuid } from 'uuid'
import { db } from './index'
import type { SyncEntity } from '../types'

/**
 * Ставит сущность в очередь отправки. Очередь — единственный путь данных наверх,
 * поэтому enqueue вызывается из КАЖДОЙ мутации, включая редактирование и удаление.
 * В прошлой версии цели, правки карт и удаления сюда не попадали — и тихо
 * откатывались ближайшим pull'ом.
 */
export async function enqueue(
  entityType: SyncEntity,
  entityId: string,
  operation: 'upsert' | 'delete',
  payload: unknown,
): Promise<void> {
  // схлопываем предыдущие записи по этой же сущности: нужен только последний снимок
  await db.syncQueue.where('entityId').equals(entityId).delete()
  await db.syncQueue.add({
    id: uuid(),
    entityType,
    entityId,
    operation,
    payload,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    lastError: null,
    dead: 0,
  })
}

/** Есть ли локальные несинхронизированные изменения по сущности (защита от перезатирания pull'ом). */
export async function hasPending(entityId: string): Promise<boolean> {
  return (await db.syncQueue.where('entityId').equals(entityId).count()) > 0
}

export async function pendingIds(): Promise<Set<string>> {
  const items = await db.syncQueue.toArray()
  return new Set(items.map(i => i.entityId))
}
