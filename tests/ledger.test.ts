import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { createAccount, computeBalances, removeAccount } from '../src/db/accounts'
import { addTransaction, updateTransaction, deleteTransaction, reconcileAccount } from '../src/db/transactions'
import { toMinor } from '../src/utils/money'
import { formatMoney } from '../src/utils/format'

const checks: [string, boolean, string][] = []
const expect = (name: string, actual: unknown, want: unknown) =>
  checks.push([name, JSON.stringify(actual) === JSON.stringify(want), `получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(want)}`])

async function bal(id: string) { return (await computeBalances()).get(id) ?? 0 }
async function total() { return [...(await computeBalances()).values()].reduce((s, v) => s + v, 0) }

const A = await createAccount({ kind: 'debit', name: 'ВТБ', bank: 'vtb', openingBalance: toMinor('10000') })
const B = await createAccount({ kind: 'savings', name: 'Накопительный', bank: 'tbank', openingBalance: toMinor('5000,50') })

expect('стартовый баланс A', await bal(A.id), 1_000_000)
expect('копейки не теряются', await bal(B.id), 500_050)

// расход
const t1 = await addTransaction({ type: 'expense', amount: toMinor('1234,56'), categoryId: 'groceries', accountId: A.id, title: 'Пятёрочка' })
expect('расход списался', await bal(A.id), 1_000_000 - 123_456)

// доход
await addTransaction({ type: 'income', amount: toMinor('50000'), categoryId: 'salary', accountId: A.id, title: 'ЗП' })
expect('доход зачислился', await bal(A.id), 1_000_000 - 123_456 + 5_000_000)

// перевод — общий баланс не меняется
const before = await total()
const t3 = await addTransaction({ type: 'transfer', amount: toMinor('2000'), categoryId: 'transfer', accountId: A.id, toAccountId: B.id, title: 'Перевод' })
expect('перевод: общий баланс не изменился', await total(), before)
expect('перевод: зачисление на B', await bal(B.id), 500_050 + 200_000)

// редактирование: меняем сумму и счёт
await updateTransaction(t1.id, { type: 'expense', amount: toMinor('2000'), categoryId: 'food', accountId: B.id, title: 'правка' })
expect('правка вернула деньги на A', await bal(A.id), 1_000_000 + 5_000_000 - 200_000)
expect('правка списала с B', await bal(B.id), 500_050 + 200_000 - 200_000)

// смена типа расход -> доход
await updateTransaction(t1.id, { type: 'income', amount: toMinor('2000'), categoryId: 'gift', accountId: B.id, title: 'правка2' })
expect('смена типа пересчитала знак', await bal(B.id), 500_050 + 200_000 + 200_000)

// удаление перевода
await deleteTransaction(t3.id)
expect('удаление перевода: A восстановлен', await bal(A.id), 1_000_000 + 5_000_000)
expect('удаление перевода: B восстановлен', await bal(B.id), 500_050 + 200_000)
expect('проводок удалённой операции нет', await db.postings.where('transactionId').equals(t3.id).count(), 0)

// валидация
let threw = ''
try { await addTransaction({ type: 'transfer', amount: toMinor('100'), categoryId: 'transfer', accountId: A.id, toAccountId: A.id, title: 'x' }) } catch (e) { threw = (e as Error).message }
expect('перевод на тот же счёт отклонён', threw, 'Счета перевода совпадают')
threw = ''
try { await addTransaction({ type: 'expense', amount: 0, categoryId: 'food', accountId: A.id, title: 'x' }) } catch (e) { threw = (e as Error).message }
expect('нулевая сумма отклонена', threw, 'Сумма должна быть больше нуля')
threw = ''
try { await addTransaction({ type: 'transfer', amount: toMinor('10'), categoryId: 'transfer', accountId: A.id, title: 'x' }) } catch (e) { threw = (e as Error).message }
expect('перевод без второго счёта отклонён', threw, 'Не выбран счёт зачисления')

// сверка
const derived = await bal(A.id)
await reconcileAccount(A.id, derived + 33_333, derived, { record: true })
expect('сверка подогнала баланс', await bal(A.id), derived + 33_333)
const adj = (await db.transactions.toArray()).find(t => t.source === 'reconciliation')
expect('корректировка вне статистики', adj?.excludeFromStats, 1)

// удаление счёта с операциями -> архив
expect('счёт с операциями архивируется', await removeAccount(A.id), 'archived')
const C = await createAccount({ kind: 'cash', name: 'Наличные', bank: 'other', openingBalance: 0 })
expect('пустой счёт удаляется', await removeAccount(C.id), 'deleted')

// очередь синхронизации наполняется
const q = await db.syncQueue.count()
checks.push(['очередь синхронизации не пустая', q > 0, `в очереди ${q}`])

// форматирование
expect('формат с копейками', formatMoney(123_456).replace(/\u00A0/g, ' '), '1 234,56 ₽')
expect('формат без копеек', formatMoney(100_000).replace(/\u00A0/g, ' '), '1 000 ₽')

let failed = 0
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : ' — ' + detail}`)
  if (!ok) failed++
}
console.log(`\n${checks.length - failed}/${checks.length} проверок пройдено`)
process.exit(failed ? 1 : 0)
