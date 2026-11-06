import 'fake-indexeddb/auto'
import { FakeBackend, pretendOnline } from './fakes/fakeBackend'

pretendOnline()

const { db } = await import('../src/db')
const { push, pull } = await import('../src/db/sync')
const { enqueue } = await import('../src/db/queue')
const { createAccount } = await import('../src/db/accounts')
const { addTransaction, deleteTransaction } = await import('../src/db/transactions')
const { toMinor } = await import('../src/utils/money')

const checks: [string, boolean, string][] = []
const eq = (name: string, got: unknown, want: unknown) =>
  checks.push([name, JSON.stringify(got) === JSON.stringify(want), `получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`])

const queueLen = () => db.syncQueue.where('dead').equals(0).count()
const deadLen = () => db.syncQueue.where('dead').equals(1).count()
const reset = async () => {
  await db.syncQueue.clear()
  await db.meta.clear()
}

// ─────────────────────────────────────────────────────────────────────────────
// Офлайн → онлайн: заведённое без сети доезжает
// ─────────────────────────────────────────────────────────────────────────────
await reset()
const acc = await createAccount({ kind: 'debit', name: 'Основной', bank: 'other', openingBalance: toMinor('10000') })
await addTransaction({ type: 'expense', amount: toMinor('1500'), categoryId: 'groceries', accountId: acc.id, title: 'Офлайн' })

const pendingBefore = await queueLen()
eq('офлайн: изменения лежат в очереди', pendingBefore > 0, true)

const srv = new FakeBackend()
const r1 = await push(srv)
eq('онлайн: очередь опустела', await queueLen(), 0)
eq('онлайн: отправлено всё, что лежало', r1.pushed, pendingBefore)
eq('счёт доехал до сервера', srv.rows('accounts').length, 1)
eq('операция доехала', srv.rows('transactions').length, 1)
eq('проводка доехала', srv.rows('postings').length, 1)
eq('сумма доехала в копейках', srv.rows('transactions')[0].amount, toMinor('1500'))
eq('ключи переведены в snake_case', 'account_id' in srv.rows('transactions')[0], true)

// ─────────────────────────────────────────────────────────────────────────────
// Обрыв посреди отправки: запись НЕ теряется и НЕ уходит в dead
// ─────────────────────────────────────────────────────────────────────────────
await reset()
await enqueue('account', 'a-timeout', 'upsert', { id: 'a-timeout', name: 'Пропавший' })

const dead1 = new FakeBackend()
dead1.failWrites({ kind: 'silent' }, 5)          // сервер молчит
const r2 = await push(dead1)
eq('таймаут: запись осталась в очереди', await queueLen(), 1)
eq('таймаут: ничего не считается отправленным', r2.pushed, 0)
eq('таймаут: в dead не уводим', await deadLen(), 0)
eq('таймаут: круг прерван, связи нет', Boolean(r2.netError), true)
eq('таймаут: сервер не долбят бесконечно', dead1.writes <= 3, true)

// та же запись доезжает, когда связь вернулась
const back = new FakeBackend()
await push(back)
eq('после возврата связи запись доехала', await queueLen(), 0)
eq('и оказалась на сервере', back.rows('accounts').length, 1)

// ─────────────────────────────────────────────────────────────────────────────
// Сетевая ошибка в ответе — тоже не повод хоронить запись
// ─────────────────────────────────────────────────────────────────────────────
await reset()
await enqueue('account', 'a-net', 'upsert', { id: 'a-net', name: 'Сеть' })
const flaky = new FakeBackend()
flaky.failWrites({ kind: 'network', message: 'Load failed' }, 5)
await push(flaky)
eq('сетевая ошибка: запись в очереди', await queueLen(), 1)
eq('сетевая ошибка: не dead', await deadLen(), 0)
const kept = await db.syncQueue.toArray()
eq('сетевая ошибка: счётчик попыток не растёт', kept[0].retryCount, 0)

// ─────────────────────────────────────────────────────────────────────────────
// Отказ сервера по содержимому — вот это в dead-letter, после MAX_RETRIES
// ─────────────────────────────────────────────────────────────────────────────
await reset()
await enqueue('account', 'a-bad', 'upsert', { id: 'a-bad', name: 'Битая' })
const picky = new FakeBackend()
picky.failWrites({ kind: 'reject', message: 'new row violates row-level security policy' }, 20)
for (let i = 0; i < 5; i++) await push(picky)
eq('отказ сервера: запись помечена dead', await deadLen(), 1)
eq('отказ сервера: из живой очереди ушла', await queueLen(), 0)
const deadItem = (await db.syncQueue.toArray())[0]
eq('отказ сервера: причина сохранена', String(deadItem.lastError).includes('row-level security'), true)

// ─────────────────────────────────────────────────────────────────────────────
// Второе устройство: pull приносит чужие изменения
// ─────────────────────────────────────────────────────────────────────────────
await reset()
await db.accounts.clear()
const other = new FakeBackend()
other.seed('accounts', {
  id: 'from-phone', kind: 'debit', name: 'С телефона', bank: 'other', currency: 'RUB',
  opening_balance: toMinor('777'), opening_date: '2026-01-01T00:00:00.000Z',
  is_archived: 0, sort_order: 0, created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z', deleted_at: null, user_id: 'u1',
})
const p1 = await pull(other)
eq('pull: чужая запись приехала', p1.pulled, 1)
const landed = await db.accounts.get('from-phone')
eq('pull: ключи переведены в camelCase', landed?.openingBalance, toMinor('777'))
eq('pull: user_id локально не хранится', 'userId' in (landed ?? {}), false)

// водяной знак: повторный pull не тащит то же самое заново
const p2 = await pull(other)
eq('pull: водяной знак сдвинулся', p2.pulled, 0)

// ─────────────────────────────────────────────────────────────────────────────
// Удаление доезжает tombstone'ом
// ─────────────────────────────────────────────────────────────────────────────
other.seed('accounts', {
  id: 'from-phone', name: 'С телефона', opening_balance: toMinor('777'),
  updated_at: '2026-01-03T00:00:00.000Z', deleted_at: '2026-01-03T00:00:00.000Z', user_id: 'u1',
})
const p3 = await pull(other)
eq('tombstone приехал', p3.pulled, 1)
eq('удалённая запись ушла локально', await db.accounts.get('from-phone'), undefined)

// ─────────────────────────────────────────────────────────────────────────────
// Локальные неотправленные правки не затираются приходящими из облака
// ─────────────────────────────────────────────────────────────────────────────
await reset()
await db.accounts.clear()
await db.accounts.put({
  id: 'contested', kind: 'debit', name: 'МОЁ локальное', bank: 'other', currency: 'RUB',
  openingBalance: toMinor('100'), openingDate: '2026-01-01T00:00:00.000Z',
  color: '#fff', isArchived: 0, sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', deletedAt: null,
})
await enqueue('account', 'contested', 'upsert', { id: 'contested', name: 'МОЁ локальное' })

const conflict = new FakeBackend()
conflict.seed('accounts', {
  id: 'contested', name: 'ЧУЖОЕ из облака', opening_balance: toMinor('999'),
  updated_at: '2026-03-01T00:00:00.000Z', deleted_at: null, user_id: 'u1',
})
await pull(conflict)
eq('неотправленная правка не затёрта', (await db.accounts.get('contested'))?.name, 'МОЁ локальное')

// и водяной знак не перепрыгнул спорную строку: после отправки облако доедет
eq('знак не ушёл за спорную строку', await db.meta.get('pullAt:account'), undefined)

// ─────────────────────────────────────────────────────────────────────────────
// Ошибка чтения не сдвигает водяной знак
// ─────────────────────────────────────────────────────────────────────────────
await reset()
await db.accounts.clear()
const broken = new FakeBackend()
broken.seed('accounts', { id: 'x', name: 'X', updated_at: '2026-05-01T00:00:00.000Z', deleted_at: null })
broken.failReads({ kind: 'silent' }, 1, 'accounts')
const pErr = await pull(broken)
eq('ошибка чтения: сообщена наверх', Boolean(pErr.error), true)
eq('ошибка чтения: знак не сдвинут', await db.meta.get('pullAt:account'), undefined)
const pRetry = await pull(broken)
eq('после восстановления строка всё-таки приехала', pRetry.pulled >= 1, true)

// ─────────────────────────────────────────────────────────────────────────────
// Удаление операции: tombstone уезжает, баланс возвращается
// ─────────────────────────────────────────────────────────────────────────────
await reset()
await db.accounts.clear(); await db.transactions.clear(); await db.postings.clear()
const acc2 = await createAccount({ kind: 'debit', name: 'Счёт', bank: 'other', openingBalance: toMinor('5000') })
const tx2 = await addTransaction({ type: 'expense', amount: toMinor('1000'), categoryId: 'food', accountId: acc2.id, title: 'Обед' })
const srv2 = new FakeBackend()
await push(srv2)
await deleteTransaction(tx2.id)
await push(srv2)
const remoteTx = srv2.rows('transactions').find(r => r.id === tx2.id)
eq('удаление уехало tombstone, а не физически', Boolean(remoteTx), true)
eq('у записи проставлен deleted_at', Boolean(remoteTx?.deleted_at), true)
eq('после удаления очередь пуста', await queueLen(), 0)

let failed = 0
for (const [name, pass, d] of checks) { console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${pass ? '' : ' — ' + d}`); if (!pass) failed++ }
console.log(`\n${checks.length - failed}/${checks.length} сквозных проверок синхронизации пройдено`)
process.exit(failed ? 1 : 0)
