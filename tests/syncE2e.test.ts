import 'fake-indexeddb/auto'
import { FakeBackend, pretendOnline } from './fakes/fakeBackend'

pretendOnline()

const { db } = await import('../src/db')
const { push, pull, planChunks, PUSH_BATCH } = await import('../src/db/sync')
const { enqueue } = await import('../src/db/queue')
const { createAccount, computeBalances } = await import('../src/db/accounts')
const {
  addTransaction, deleteTransaction, restoreTransaction, purgeOldTrash, TRASH_KEEP_DAYS,
} = await import('../src/db/transactions')
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

// ─────────────────────────────────────────────────────────────────────────────
// Отправка пачками: много записей — мало запросов
// ─────────────────────────────────────────────────────────────────────────────
await reset()
await db.transactions.clear(); await db.postings.clear()
for (let i = 0; i < 25; i++) {
  await addTransaction({ type: 'expense', amount: toMinor('100') + i, categoryId: 'food', accountId: acc2.id, title: `Пачка ${i}` })
}
const queued = await queueLen()
eq('пачка: в очереди операции и проводки', queued, 50)

const bulk = new FakeBackend()
const rb = await push(bulk)
eq('пачка: ушло всё', rb.pushed, 50)
eq('пачка: очередь пуста', await queueLen(), 0)
eq('пачка: запросов на порядок меньше, чем записей', bulk.writes, 2)
eq('пачка: операции на сервере', bulk.rows('transactions').length, 25)
eq('пачка: проводки на сервере', bulk.rows('postings').length, 25)
eq('пачка: суммы не перепутаны', bulk.rows('transactions').map(r => r.amount).sort((a, b) => Number(a) - Number(b))[24], toMinor('100') + 24)

// раскладка: записи с разным набором полей в одну пачку не попадают
const mk = (id: string, entityType: 'account' | 'settings', payload: Record<string, unknown>, operation: 'upsert' | 'delete' = 'upsert') =>
  ({ id, entityType, entityId: id, operation, payload, createdAt: id, retryCount: 0, lastError: null, dead: 0 as const })
const plan = planChunks([
  mk('1', 'account', { id: '1', name: 'A' }),
  mk('2', 'account', { id: '2', name: 'B', creditLimit: 5 }),
  mk('3', 'account', { id: '3', name: 'C' }),
  mk('4', 'account', null as never, 'delete'),
  mk('5', 'settings', { id: 1, userName: 'x' }),
])
eq('раскладка: одинаковые по полям — вместе', plan[0].items.map(i => i.id), ['1', '3'])
eq('раскладка: лишнее поле — отдельная пачка', plan[1].items.map(i => i.id), ['2'])
eq('раскладка: удаления отдельно от вставок', plan[2].operation, 'delete')
eq('раскладка: настройки всегда поодиночке', plan[3].items.length, 1)
const big = planChunks(Array.from({ length: PUSH_BATCH + 5 }, (_, i) => mk(`b${i}`, 'account', { id: `b${i}` })))
eq('раскладка: длинная очередь режется на пачки', big.map(c => c.items.length), [PUSH_BATCH, 5])

// ─────────────────────────────────────────────────────────────────────────────
// Одна битая запись не хоронит соседей по пачке
// ─────────────────────────────────────────────────────────────────────────────
await reset()
for (let i = 0; i < 6; i++) await enqueue('account', `p${i}`, 'upsert', { id: `p${i}`, name: `Счёт ${i}` })
const strict = new FakeBackend()
strict.poison = p => p.id === 'p3'
const rp = await push(strict)
eq('яд: хорошие записи доехали', strict.rows('accounts').length, 5)
eq('яд: в очереди остался только виновник', (await db.syncQueue.toArray()).map(i => i.entityId), ['p3'])
eq('яд: соседи не получили штрафных попыток', rp.pushed, 5)
eq('яд: виновник получил одну попытку, а не dead сразу', (await db.syncQueue.toArray())[0].retryCount, 1)
for (let i = 0; i < 5; i++) await push(strict)
eq('яд: после MAX_RETRIES виновник в dead', await deadLen(), 1)

// ─────────────────────────────────────────────────────────────────────────────
// Обрыв связи на пачке: ничего не теряется и не штрафуется
// ─────────────────────────────────────────────────────────────────────────────
await reset()
for (let i = 0; i < 8; i++) await enqueue('account', `n${i}`, 'upsert', { id: `n${i}`, name: `Сеть ${i}` })
const down = new FakeBackend()
down.failWrites({ kind: 'silent' }, 5)
const rn = await push(down)
eq('обрыв пачки: все записи в очереди', await queueLen(), 8)
eq('обрыв пачки: сообщено, что связи нет', Boolean(rn.netError), true)
eq('обрыв пачки: попытки не считаются', (await db.syncQueue.toArray()).every(i => i.retryCount === 0), true)
eq('обрыв пачки: сервер тронут один раз', down.writes, 1)
await push(new FakeBackend())
eq('обрыв пачки: после возврата связи всё уехало', await queueLen(), 0)

// ─────────────────────────────────────────────────────────────────────────────
// Корзина: удалённую операцию можно вернуть, баланс сходится
// ─────────────────────────────────────────────────────────────────────────────
await reset()
await db.accounts.clear(); await db.transactions.clear(); await db.postings.clear(); await db.trash.clear()
const acc3 = await createAccount({ kind: 'debit', name: 'Корзина', bank: 'other', openingBalance: toMinor('5000') })
const acc4 = await createAccount({ kind: 'debit', name: 'Второй', bank: 'other', openingBalance: toMinor('0') })
const gone = await addTransaction({ type: 'expense', amount: toMinor('1200'), categoryId: 'food', accountId: acc3.id, title: 'Ужин' })
const moved = await addTransaction({ type: 'transfer', amount: toMinor('700'), categoryId: 'transfer', accountId: acc3.id, toAccountId: acc4.id })
const srv3 = new FakeBackend()
await push(srv3)

await deleteTransaction(gone.id)
eq('корзина: операция исчезла из истории', await db.transactions.get(gone.id), undefined)
eq('корзина: баланс вернулся', (await computeBalances()).get(acc3.id), toMinor('5000') - toMinor('700'))
eq('корзина: операция лежит в корзине', (await db.trash.get(gone.id))?.tx.title, 'Ужин')
await push(srv3)
eq('корзина: на сервер ушёл tombstone', Boolean(srv3.rows('transactions').find(r => r.id === gone.id)?.deleted_at), true)

const back2 = await restoreTransaction(gone.id)
eq('возврат: операция снова в истории', (await db.transactions.get(gone.id))?.amount, toMinor('1200'))
eq('возврат: deletedAt снят', back2.deletedAt, null)
eq('возврат: проводка собрана заново', (await db.postings.where('transactionId').equals(gone.id).toArray()).length, 1)
eq('возврат: баланс снова учитывает расход', (await computeBalances()).get(acc3.id), toMinor('5000') - toMinor('700') - toMinor('1200'))
eq('возврат: корзина пуста', await db.trash.count(), 0)
await push(srv3)
eq('возврат: на сервере строка ожила', srv3.rows('transactions').find(r => r.id === gone.id)?.deleted_at, null)
eq('возврат: очередь пуста', await queueLen(), 0)

// перевод возвращается двумя ногами — деньги не появляются из воздуха
await deleteTransaction(moved.id)
eq('корзина: перевод снят с обоих счетов', (await computeBalances()).get(acc4.id), 0)
await restoreTransaction(moved.id)
const balAfter = await computeBalances()
eq('возврат перевода: две ноги', (await db.postings.where('transactionId').equals(moved.id).toArray()).length, 2)
eq('возврат перевода: сумма по кабинету не изменилась',
  (balAfter.get(acc3.id) ?? 0) + (balAfter.get(acc4.id) ?? 0), toMinor('5000') - toMinor('1200'))

// повторный возврат и возврат несуществующего
let restoreError = ''
try { await restoreTransaction('нет-такой') } catch (e) { restoreError = (e as Error).message }
eq('возврат: чего нет в корзине — понятная ошибка', restoreError, 'Операции нет в корзине')

// счёт удалён — вернуть некуда, и корзина при этом не теряет запись
const orphan = await addTransaction({ type: 'expense', amount: toMinor('50'), categoryId: 'food', accountId: acc4.id, title: 'Сирота' })
await deleteTransaction(orphan.id)
await db.accounts.delete(acc4.id)
let orphanError = ''
try { await restoreTransaction(orphan.id) } catch (e) { orphanError = (e as Error).message }
eq('возврат: без счёта не возвращаем', orphanError.includes('вернуть её некуда'), true)
eq('возврат: запись осталась в корзине', Boolean(await db.trash.get(orphan.id)), true)

// старое выметается, свежее остаётся
await db.trash.clear()
const DAY = 86_400_000
const NOW = Date.parse('2026-11-14T12:00:00.000Z')
const stub = (id: string, daysAgo: number) => ({
  id, deletedAt: new Date(NOW - daysAgo * DAY).toISOString(),
  tx: { ...orphan, id },
})
await db.trash.bulkPut([stub('свежая', 3), stub('старая', TRASH_KEEP_DAYS + 1)])
eq('уборка корзины: выброшена одна', await purgeOldTrash(NOW), 1)
eq('уборка корзины: свежая на месте', (await db.trash.toArray()).map(t => t.id), ['свежая'])

// ─────────────────────────────────────────────────────────────────────────────
// Корзина сходится между устройствами через pull
// ─────────────────────────────────────────────────────────────────────────────
await reset()
await db.transactions.clear(); await db.postings.clear(); await db.trash.clear()
const recent = new Date(Date.now() - 2 * DAY).toISOString()
const ancient = new Date(Date.now() - (TRASH_KEEP_DAYS + 30) * DAY).toISOString()
const remoteTxRow = (id: string, over: Record<string, unknown>) => ({
  id, type: 'expense', amount: toMinor('300'), category_id: 'food', account_id: acc3.id,
  title: id, date: recent, exclude_from_stats: 0, source: 'manual',
  created_at: recent, updated_at: recent, deleted_at: null, user_id: 'u1', ...over,
})
const far = new FakeBackend()
far.seed('transactions', remoteTxRow('живая', {}))
far.seed('transactions', remoteTxRow('удалена-там', { deleted_at: recent }))
far.seed('transactions', remoteTxRow('удалена-давно', { deleted_at: ancient, updated_at: ancient }))
await pull(far)
eq('pull: живая операция приехала', Boolean(await db.transactions.get('живая')), true)
eq('pull: удалённая на другом устройстве попала в корзину', (await db.trash.get('удалена-там'))?.tx.amount, toMinor('300'))
eq('pull: в историю она не попала', await db.transactions.get('удалена-там'), undefined)
eq('pull: давно удалённое в корзину не тащим', await db.trash.get('удалена-давно'), undefined)

// на другом устройстве операцию вернули — из корзины она уходит
const later = new Date(Date.now() - DAY).toISOString()
far.seed('transactions', remoteTxRow('удалена-там', { updated_at: later }))
await pull(far)
eq('pull: возвращённая там операция ожила здесь', Boolean(await db.transactions.get('удалена-там')), true)
eq('pull: и ушла из корзины', await db.trash.get('удалена-там'), undefined)

// таблицы читаются независимо: сбой одной не мешает остальным
await reset()
await db.accounts.clear(); await db.transactions.clear()
const half = new FakeBackend()
half.seed('accounts', { id: 'acc-ok', name: 'Доехал', updated_at: '2026-05-01T00:00:00.000Z', deleted_at: null })
half.seed('transactions', remoteTxRow('tx-late', {}))
half.failReads({ kind: 'silent' }, 1, 'transactions')
const pHalf = await pull(half)
eq('сбой одной таблицы: остальные приехали', Boolean(await db.accounts.get('acc-ok')), true)
eq('сбой одной таблицы: ошибка названа', String(pHalf.error).includes('transactions'), true)
eq('сбой одной таблицы: её знак не сдвинут', await db.meta.get('pullAt:transaction'), undefined)
eq('сбой одной таблицы: знак соседней сдвинут', Boolean(await db.meta.get('pullAt:account')), true)

let failed = 0
for (const [name, pass, d] of checks) { console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${pass ? '' : ' — ' + d}`); if (!pass) failed++ }
console.log(`\n${checks.length - failed}/${checks.length} сквозных проверок синхронизации пройдено`)
process.exit(failed ? 1 : 0)
