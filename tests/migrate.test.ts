import 'fake-indexeddb/auto'
import Dexie from 'dexie'

// 1. создаём «старую» базу версии 2 с рублями-float и boolean-флагами
const old = new Dexie('FinFlowDB')
old.version(2).stores({
  transactions: 'id, type, categoryId, cardId, date, createdAt, syncedAt, goalId',
  cards: 'id, bank', goals: 'id, isArchived, createdAt',
  deposits: 'id, isActive, expectedDate',
  recurringPayments: 'id, cardId, isActive', settings: 'id',
  syncQueue: 'id, entityType, entityId, createdAt',
})
await old.open()
await old.table('cards').bulkPut([
  { id: 'vtb', name: 'ВТБ', bank: 'vtb', balance: 42310.55, lastFour: '1234', color: '#005CA9', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'tbank', name: 'Т-Банк', bank: 'tbank', balance: 8000, lastFour: '9999', color: '#B8860B', updatedAt: '2026-01-01T00:00:00.000Z' },
])
await old.table('deposits').add({ id: 'dep1', name: 'Вклад', bank: 'sber', amount: 300000, interestRate: 16, expectedDate: '2026-12-01', color: '#21A038', createdAt: '2026-01-01T00:00:00.000Z', isActive: true })
await old.table('transactions').bulkPut([
  { id: 't1', type: 'expense', amount: 1500.40, categoryId: 'food', cardId: 'vtb', title: 'Кафе', date: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
  { id: 't2', type: 'income', amount: 90000, categoryId: 'salary', cardId: 'vtb', title: 'ЗП', date: '2026-09-05T10:00:00.000Z', createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' },
  { id: 't3', type: 'transfer', amount: 5000, categoryId: 'other_exp', cardId: 'vtb', toCardId: 'tbank', title: 'Перевод', date: '2026-09-06T10:00:00.000Z', createdAt: '2026-09-06T10:00:00.000Z', updatedAt: '2026-09-06T10:00:00.000Z' },
  { id: 't4', type: 'expense', amount: 700, categoryId: 'food', cardId: 'ghost', title: 'Потерянный счёт', date: '2026-09-07T10:00:00.000Z', createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z' },
])
await old.table('goals').add({ id: 'g1', title: 'PS5', icon: '🎮', targetAmount: 70000, currentAmount: 12500.75, createdAt: '2026-05-01T00:00:00.000Z', isArchived: false })
await old.table('settings').put({ id: 1, userName: 'Denis', categoryLimits: [], theme: 'dark', currency: '₽' })
old.close()

// 2. открываем новой схемой — срабатывает upgrade
const { db } = await import('../src/db')
const { computeBalances } = await import('../src/db/accounts')
await db.open()

const checks: [string, boolean, string][] = []
const eq = (n: string, a: unknown, b: unknown) => checks.push([n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`])

const bal = await computeBalances()
eq('карты стали счетами', await db.accounts.count(), 4)              // 2 карты + вклад + восстановленный 'ghost'
eq('баланс ВТБ сохранён до копейки', bal.get('vtb'), 4231055)
eq('баланс Т-Банк сохранён', bal.get('tbank'), 800000)
eq('вклад перенесён', bal.get('dep1'), 30000000)
eq('сирота-счёт восстановлен', bal.get('ghost'), 0)
eq('операции перенесены', await db.transactions.count(), 4)
const t3 = await db.transactions.get('t3')
eq('перевод получил вторую ногу', (await db.postings.where('transactionId').equals('t3').toArray()).length, 2)
eq('перевод исключён из статистики', t3?.excludeFromStats, 1)
const g = await db.goals.get('g1')
eq('цель: сумма в копейках', g?.targetAmount, 7000000)
eq('цель: накоплено в копейках', g?.manualAmount, 1250075)
eq('цель: флаг стал числом', g?.isArchived, 0)
eq('старые хранилища удалены', db.tables.map(t => t.name).includes('cards'), false)

// v4→v5: таблица категорий существует и пустая (встроенные живут в коде)
eq('таблица categories создана', db.tables.map(t => t.name).includes('categories'), true)
eq('categories после миграции пуста', await db.categories.count(), 0)

// v5→v6: корзина удалённых операций создана и пуста, история при этом цела
eq('таблица trash создана', db.tables.map(t => t.name).includes('trash'), true)
eq('trash после миграции пуста', await db.trash.count(), 0)
eq('v6 не тронула операции', await db.transactions.count(), 4)

let failed = 0
for (const [n, ok, d] of checks) { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${ok ? '' : ' — ' + d}`); if (!ok) failed++ }
console.log(`\n${checks.length - failed}/${checks.length} проверок миграции пройдено`)
process.exit(failed ? 1 : 0)
