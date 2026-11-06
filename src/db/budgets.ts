import { v4 as uuid } from 'uuid'
import { db } from './index'
import { enqueue } from './queue'
import type { Budget, Minor } from '../types'

export async function setBudget(categoryId: string, amount: Minor): Promise<void> {
  const now = new Date().toISOString()
  const existing = await db.budgets.where('categoryId').equals(categoryId).first()
  if (amount <= 0) {
    if (existing) {
      await db.budgets.delete(existing.id)
      await enqueue('budget', existing.id, 'delete', null)
    }
    return
  }
  const budget: Budget = existing
    ? { ...existing, amount, updatedAt: now }
    : { id: uuid(), categoryId, amount, period: 'month', updatedAt: now, deletedAt: null }
  await db.budgets.put(budget)
  await enqueue('budget', budget.id, 'upsert', budget)
}
