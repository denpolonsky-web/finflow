import 'fake-indexeddb/auto'
import { db, PRIMARY_PROFILE_ID } from '../src/db'
import { createAccount } from '../src/db/accounts'
import { addTransaction } from '../src/db/transactions'
import {
  ensureDefaultProfile, createProfile, removeProfile, renameProfile,
  setProfilePin, checkPin, setActiveProfileId, setProfileRole, isLastPrimary,
  ROLE_RIGHTS,
} from '../src/db/profiles'
import { toMinor } from '../src/utils/money'
import {
  applyFilters, buildReport, reportTotal, reportToCsv, rawToCsv, EMPTY_FILTERS,
} from '../src/utils/report'
import type { Transaction } from '../src/types'

// localStorage в node нет — подменяем минимальной заглушкой
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage

const checks: [string, boolean, string][] = []
const expect = (name: string, actual: unknown, want: unknown) =>
  checks.push([name, JSON.stringify(actual) === JSON.stringify(want), `получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(want)}`])

// ── профили ────────────────────────────────────────────────────────────────

const primary = await ensureDefaultProfile('Игорь')
expect('основной профиль создан с фиксированным id', primary.id, PRIMARY_PROFILE_ID)
expect('основной профиль — главная роль', primary.role, 'primary')

const again = await ensureDefaultProfile('Другое имя')
expect('повторный вызов не плодит профили', again.id, primary.id)
expect('профиль в базе ровно один', await db.profiles.count(), 1)

const member = await createProfile({ name: 'Катя', role: 'member' })
expect('второй профиль — ограниченная роль', member.role, 'member')

await renameProfile(member.id, '  Катюша  ')
expect('переименование обрезает пробелы', (await db.profiles.get(member.id))?.name, 'Катюша')

await setProfilePin(member.id, '1234')
const withPin = (await db.profiles.get(member.id))!
expect('пин хранится хэшем, а не текстом', withPin.pinHash?.includes('1234'), false)
expect('верный пин принят', await checkPin(withPin, '1234'), true)
expect('неверный пин отклонён', await checkPin(withPin, '0000'), false)
expect('профиль без пина пускает всех', await checkPin(primary, 'что угодно'), true)

expect('профиль попал в очередь синхронизации',
  await db.syncQueue.where('entityId').equals(member.id).count() > 0, true)

// ── смена ролей ────────────────────────────────────────────────────────────

expect('главный профиль — единственный', await isLastPrimary(primary.id), true)
expect('последний главный не понижается', await setProfileRole(primary.id, 'member'), 'blocked')
expect('роль осталась прежней', (await db.profiles.get(primary.id))?.role, 'primary')

expect('повышение роли разрешено', await setProfileRole(member.id, 'primary'), 'ok')
expect('теперь главных двое', await isLastPrimary(primary.id), false)
expect('понижение при двух главных проходит', await setProfileRole(primary.id, 'member'), 'ok')
expect('и обратно', await setProfileRole(primary.id, 'primary'), 'ok')
expect('возвращаем второй профиль в ограниченную роль', await setProfileRole(member.id, 'member'), 'ok')

expect('у полного доступа нет запретов', ROLE_RIGHTS.primary.cannot.length, 0)
expect('у ограниченной роли запреты описаны', ROLE_RIGHTS.member.cannot.length > 0, true)

// ── операции привязываются к активному профилю ──────────────────────────────

const acc = await createAccount({ kind: 'debit', name: 'ВТБ', bank: 'vtb', openingBalance: toMinor('10000') })

setActiveProfileId(primary.id)
await addTransaction({ type: 'expense', amount: toMinor('1000'), categoryId: 'groceries', accountId: acc.id, title: 'Продукты' })
await addTransaction({ type: 'income', amount: toMinor('50000'), categoryId: 'salary', accountId: acc.id, title: 'ЗП' })

setActiveProfileId(member.id)
await addTransaction({ type: 'expense', amount: toMinor('300'), categoryId: 'food', accountId: acc.id, title: 'Кофе' })
await addTransaction({ type: 'expense', amount: toMinor('700'), categoryId: 'food', accountId: acc.id, title: 'Обед' })

const all = await db.transactions.toArray()
expect('операция помечена активным профилем',
  all.filter(t => t.profileId === member.id).length, 2)

// видимость: вторая роль видит только свои
const scopeMember = (txs: Transaction[]) => txs.filter(t => t.profileId === member.id)
expect('вторая роль видит только свои операции', scopeMember(all).length, 2)
expect('главная роль видит все', all.length, 4)

// ── архивация и удаление ───────────────────────────────────────────────────

expect('профиль с операциями архивируется, а не удаляется', await removeProfile(member.id), 'archived')
expect('после архивации профиль остался в базе', Boolean(await db.profiles.get(member.id)), true)
expect('последний главный профиль удалить нельзя', await removeProfile(primary.id), 'blocked')

const spare = await createProfile({ name: 'Пустой', role: 'member' })
expect('профиль без операций удаляется', await removeProfile(spare.id), 'deleted')

// ── конструктор отчётов ────────────────────────────────────────────────────

const maps = { accounts: await db.accounts.toArray(), profiles: await db.profiles.toArray() }

const onlyExpense = applyFilters(all, { ...EMPTY_FILTERS, types: ['expense'] })
expect('фильтр по типу', onlyExpense.length, 3)

const byAmount = applyFilters(all, { ...EMPTY_FILTERS, minAmount: toMinor('500') })
expect('фильтр по минимальной сумме', byAmount.length, 3)

const bySearch = applyFilters(all, { ...EMPTY_FILTERS, search: 'коф' })
expect('поиск по названию', bySearch.length, 1)

const byProfile = applyFilters(all, { ...EMPTY_FILTERS, profileIds: [member.id] })
expect('фильтр по профилю', byProfile.length, 2)

const catRows = buildReport(all, 'category', 'expense', maps)
expect('разрез по категориям: строк', catRows.length, 2)
expect('категории отсортированы по убыванию', catRows[0].label, 'Кафе и еда')
expect('сумма по «Кафе и еда»', catRows[0].value, toMinor('1000'))
expect('доли дают 100%', Math.round(catRows.reduce((s, r) => s + r.share, 0)), 100)

expect('итог по расходам', reportTotal(catRows, 'expense'), toMinor('2000'))

const netRows = buildReport(all, 'type', 'net', maps)
expect('чистый поток считается', reportTotal(netRows, 'net'), toMinor('50000') - toMinor('2000'))

const profRows = buildReport(all, 'profile', 'expense', maps)
expect('разрез по профилям: две строки', profRows.length, 2)

const countRows = buildReport(all, 'category', 'count', maps)
expect('метрика «количество»', reportTotal(countRows, 'count'), 4)

const avgRows = buildReport(all, 'account', 'avg', maps)
expect('средний чек расхода', avgRows[0].value, Math.round(toMinor('2000') / 3))

const csv = reportToCsv(catRows, 'category', 'expense', 'Тест')
expect('CSV с BOM для Excel', csv.startsWith('\uFEFF'), true)
expect('CSV с разделителем «;»', csv.includes(';'), true)
expect('CSV с десятичной запятой', csv.includes('1000,00'), true)

const raw = rawToCsv(all, maps, 'Тест')
expect('выгрузка сырых операций содержит все строки', raw.trim().split('\r\n').length, 4 + 3)
expect('в выгрузке есть колонка профиля', raw.includes('Профиль'), true)

// ── отчёт ──────────────────────────────────────────────────────────────────

let bad = 0
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`)
  if (!ok) bad++
}
console.log(`\n${checks.length - bad}/${checks.length} проверок профилей и аналитики пройдено`)
process.exit(bad ? 1 : 0)
