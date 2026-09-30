import { v4 as uuid } from 'uuid'
import { db } from './index'
import type { Transaction, TransactionType, CardId } from '../types'

async function syncCard(cardId: string) {
  const card = await db.cards.get(cardId)
  if (!card) return
  const now = new Date().toISOString()
  await db.syncQueue.add({
    id: uuid(),
    entityType: 'card',
    entityId: cardId,
    operation: 'update',
    payload: {
      id: card.id,
      name: card.name,
      bank: card.bank,
      balance: card.balance,
      lastFour: card.lastFour,
      color: card.color,
      updatedAt: now,
    },
    createdAt: now,
  })
}

export async function addTransaction(data: {
  type: TransactionType
  amount: number
  categoryId: string
  cardId: CardId
  toCardId?: CardId
  title: string
  comment?: string
  tags?: string[]
  date?: string
  goalId?: string
}): Promise<Transaction> {
  const now = new Date().toISOString()
  const tx: Transaction = {
    id: uuid(),
    ...data,
    date: data.date ?? now,
    createdAt: now,
    updatedAt: now,
  }
  await db.transactions.add(tx)

  // Sync transaction
  await db.syncQueue.add({
    id: uuid(),
    entityType: 'transaction',
    entityId: tx.id,
    operation: 'create',
    payload: tx,
    createdAt: now,
  })

  // Update card balance locally + sync
  const card = await db.cards.get(data.cardId)
  if (card) {
    const newBalance = data.type === 'income'
      ? card.balance + data.amount
      : card.balance - data.amount
    await db.cards.update(data.cardId, { balance: newBalance, updatedAt: now })
    await syncCard(data.cardId)
  }

  return tx
}

export async function updateTransaction(
  id: string,
  data: Partial<Omit<Transaction, 'id' | 'createdAt'>>
): Promise<void> {
  const now = new Date().toISOString()
  await db.transactions.update(id, { ...data, updatedAt: now })
  await db.syncQueue.add({
    id: uuid(),
    entityType: 'transaction',
    entityId: id,
    operation: 'update',
    payload: data,
    createdAt: now,
  })
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.transactions.delete(id)
  await db.syncQueue.add({
    id: uuid(),
    entityType: 'transaction',
    entityId: id,
    operation: 'delete',
    payload: null,
    createdAt: new Date().toISOString(),
  })
}

// Update card balance manually (from CardsScreen)
export async function updateCardBalance(cardId: string, newBalance: number): Promise<void> {
  const now = new Date().toISOString()
  await db.cards.update(cardId, { balance: newBalance, updatedAt: now })
  await syncCard(cardId)
}
