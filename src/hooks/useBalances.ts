import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { computeBalances } from '../db/accounts'
import type { Account, Minor } from '../types'

/** Балансы пересчитываются из проводок при любом изменении — хранимого баланса нет. */
export function useBalances(): Map<string, Minor> {
  return useLiveQuery(async () => {
    await db.postings.count()   // подписка на изменения проводок
    return computeBalances()
  }, [], new Map<string, Minor>())
}

export function useAccounts(includeArchived = false): Account[] | undefined {
  return useLiveQuery(
    () => db.accounts.orderBy('sortOrder').toArray()
      .then(list => (includeArchived ? list : list.filter(a => !a.isArchived))),
    [includeArchived],
  )
}

/** Ликвидные средства: всё, кроме вкладов и кредитного долга. */
export function liquidTotal(accounts: Account[], balances: Map<string, Minor>): Minor {
  return accounts
    .filter(a => a.kind === 'debit' || a.kind === 'cash' || a.kind === 'savings')
    .reduce((s, a) => s + (balances.get(a.id) ?? 0), 0)
}

/** Чистая стоимость: все счета, включая вклады и минус по кредиткам. */
export function netWorth(accounts: Account[], balances: Map<string, Minor>): Minor {
  return accounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0)
}
