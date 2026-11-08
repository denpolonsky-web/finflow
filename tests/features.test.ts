import 'fake-indexeddb/auto'
import { biggestExpense, byDay, byDayBlocks } from '../src/utils/analytics'
import { buildReport } from '../src/utils/report'
import { cutAtDayEnd } from '../src/utils/txGroups'
import { comparableCutoff } from '../src/utils/period'
import { depositInfo, depositProjection } from '../src/db/accounts'
import { WIDGETS, DEFAULT_WIDGETS, scopeLabel } from '../src/utils/uiPrefs'
import { toMinor } from '../src/utils/money'
import type { Account, Transaction } from '../src/types'

const checks: [string, boolean, string][] = []
const eq = (name: string, got: unknown, want: unknown) =>
  checks.push([name, JSON.stringify(got) === JSON.stringify(want), `получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`])

// ── Аналитика по дням (G6.4) ────────────────────────────────────────────────

/**
 * Дата из ЛОКАЛЬНЫХ частей: `byDayBlocks` группирует по местному дню, поэтому
 * фиксированные `...Z`-строки сделали бы тест зависимым от часового пояса
 * машины (19:00 UTC — это уже следующие сутки восточнее UTC+5).
 */
const at = (y: number, mo: number, d: number, h: number) =>
  new Date(y, mo - 1, d, h, 0, 0).toISOString()

const tx = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), type: 'expense', amount: toMinor('100'),
  categoryId: 'groceries', accountId: 'a', title: '', date: at(2026, 3, 10, 12),
  excludeFromStats: 0, source: 'manual', createdAt: '', updatedAt: '', deletedAt: null, ...over,
})

const blocks = byDayBlocks([
  tx({ date: at(2026, 3, 10, 9), amount: toMinor('1000'), categoryId: 'groceries' }),
  tx({ date: at(2026, 3, 10, 18), amount: toMinor('500'), categoryId: 'food' }),
  tx({ date: at(2026, 3, 10, 19), amount: toMinor('500'), categoryId: 'groceries' }),
  tx({ date: at(2026, 3, 11, 10), amount: toMinor('200'), categoryId: 'transport' }),
  tx({ date: at(2026, 3, 12, 10), amount: toMinor('3000'), type: 'income', categoryId: 'salary' }),
])

eq('дни сгруппированы в блоки', blocks.length, 3)
eq('свежие дни сверху', blocks[0].date, '2026-03-12')
eq('расход дня суммируется', blocks.find(b => b.date === '2026-03-10')?.expense, toMinor('2000'))
eq('операции дня посчитаны', blocks.find(b => b.date === '2026-03-10')?.count, 3)
eq('доход отделён от расхода', blocks.find(b => b.date === '2026-03-12')?.income, toMinor('3000'))
eq('чистый поток дня', blocks.find(b => b.date === '2026-03-11')?.net, -toMinor('200'))

const heavy = blocks.find(b => b.date === '2026-03-10')!
eq('категории дня схлопнуты', heavy.categories.length, 2)
eq('категории дня по убыванию', heavy.categories[0].categoryId, 'groceries')
eq('повторы в категории посчитаны', heavy.categories[0].count, 2)
eq('сумма по категории дня', heavy.categories[0].amount, toMinor('1500'))
eq('самый дорогой день имеет вес 1', heavy.weight, 1)
eq('дорогой день подсвечен', heavy.heavy, true)
eq('обычный день не подсвечен', blocks.find(b => b.date === '2026-03-11')?.heavy, false)

// Переводы и корректировки в разбор по дням не попадают
const withTransfer = byDayBlocks([
  tx({ date: at(2026, 3, 10, 9), amount: toMinor('100') }),
  tx({ date: at(2026, 3, 10, 10), amount: toMinor('9999'), type: 'transfer', excludeFromStats: 1 }),
])
eq('перевод не искажает день', withTransfer[0].expense, toMinor('100'))
eq('перевод не попал в счётчик', withTransfer[0].count, 1)
eq('пустых дней в перечне нет', byDayBlocks([]).length, 0)

// ── Сопоставимая граница прошлого периода ───────────────────────────────────
// Текущий месяц идёт седьмой день — у прошлого берём тоже семь дней,
// иначе «к прошлому периоду» сравнивает часть с целым и всегда показывает минус.

const nov = { from: new Date(2026, 10, 1), to: new Date(2026, 10, 30, 23, 59, 59, 999), label: '' }
const oct = { from: new Date(2026, 9, 1), to: new Date(2026, 9, 31, 23, 59, 59, 999), label: '' }
const sevenDaysIn = new Date(2026, 10, 8).getTime()   // прошло ровно 7 суток ноября

eq('граница прошлого периода — те же 7 дней',
  comparableCutoff(nov, oct, sevenDaysIn), new Date(2026, 9, 8).toISOString())
eq('завершённый период не обрезается',
  comparableCutoff(oct, { from: new Date(2026, 8, 1), to: new Date(2026, 8, 30), label: '' }, sevenDaysIn), null)
eq('будущий период не обрезается', comparableCutoff(nov, oct, new Date(2026, 9, 15).getTime()), null)

// ── Факты месяца на главной: крупнейшая трата ───────────────────────────────

eq('пустая выборка — блока нет', biggestExpense([]), null)

const big = biggestExpense([
  tx({ id: 'a', amount: toMinor('1000') }),
  tx({ id: 'b', amount: toMinor('3000') }),
  tx({ id: 'c', amount: toMinor('1000'), type: 'income', categoryId: 'salary' }),
])
eq('нашлась самая крупная трата', big?.tx.id, 'b')
eq('доля считается от расходов, доход не в счёт', Math.round(big?.share ?? 0), 75)

// перевод и операция вне статистики не могут стать «крупнейшей тратой»
const bigClean = biggestExpense([
  tx({ id: 'a', amount: toMinor('500') }),
  tx({ id: 'b', amount: toMinor('90000'), type: 'transfer' }),
  tx({ id: 'c', amount: toMinor('80000'), excludeFromStats: 1 }),
])
eq('перевод и исключённая не попадают в крупнейшую', bigClean?.tx.id, 'a')
eq('одна трата — это 100% расходов', Math.round(bigClean?.share ?? 0), 100)

// тай-брейк: при равных суммах порядок не должен «плавать»
eq('равные суммы разводятся по id',
  biggestExpense([tx({ id: 'z', amount: toMinor('100') }), tx({ id: 'a', amount: toMinor('100') })])?.tx.id,
  'a')

// ── Непрерывная шкала дней для графика (byDay) ──────────────────────────────
//
// Шкала обязана совпадать с разбором по дням и с лентой операций: раньше
// и ключ операции, и шаг шкалы считались по UTC, и в плюсовом поясе весь
// график уезжал на сутки — столбик «1 ноября» показывал траты 31 октября.

const march = {
  from: new Date(2026, 2, 10, 0, 0, 0),
  to: new Date(2026, 2, 12, 23, 59, 59, 999),
  label: 'тест',
}
const points = byDay([
  tx({ date: at(2026, 3, 10, 0), amount: toMinor('100') }),           // сразу после полуночи
  tx({ date: at(2026, 3, 11, 23), amount: toMinor('200') }),          // поздно вечером
  tx({ date: at(2026, 3, 12, 12), amount: toMinor('300'), type: 'income', categoryId: 'salary' }),
], march)

eq('в шкале все дни периода', points.map(p => p.date), ['2026-03-10', '2026-03-11', '2026-03-12'])
eq('ночная операция осталась в своём дне', points[0].expense, toMinor('100'))
eq('вечерняя операция не уехала на завтра', points[1].expense, toMinor('200'))
eq('доход отделён', points[2].income, toMinor('300'))
eq('накопительная кривая растёт по расходам', points.map(p => p.cumulative),
  [toMinor('100'), toMinor('300'), toMinor('300')])

// ── Группировка отчёта по дням и месяцам ────────────────────────────────────
// Та же причина: операция, заведённая 1-го числа в 00:30, не должна попадать
// в отчёт за прошлый месяц.

const reportMaps = { accounts: [], profiles: [] }
const nightTx = [tx({ date: at(2026, 4, 1, 0), amount: toMinor('700') })]
eq('день в отчёте — местный', buildReport(nightTx, 'day', 'expense', reportMaps)[0].key, '2026-04-01')
eq('месяц в отчёте — местный', buildReport(nightTx, 'month', 'expense', reportMaps)[0].key, '2026-04')

// ── Подгрузка ленты до границы дня ──────────────────────────────────────────
// Оборванная посередине дня страница давала итог дня по половине операций.

const feed = [
  tx({ date: at(2026, 5, 3, 20) }),
  tx({ date: at(2026, 5, 3, 12) }),
  tx({ date: at(2026, 5, 2, 20) }),
  tx({ date: at(2026, 5, 2, 15) }),
  tx({ date: at(2026, 5, 2, 10) }),
  tx({ date: at(2026, 5, 1, 10) }),
]
eq('срез расширяется до конца дня', cutAtDayEnd(feed, 3), 5)
eq('срез на границе дня не растёт', cutAtDayEnd(feed, 2), 2)
eq('срез не выходит за список', cutAtDayEnd(feed, 99), feed.length)
eq('пустой срез остаётся пустым', cutAtDayEnd(feed, 0), 0)
eq('пустой список', cutAtDayEnd([], 10), 0)

// ── Вклады (G6.3) ───────────────────────────────────────────────────────────
const deposit = (over: Partial<Account>): Account => ({
  id: 'd', kind: 'deposit', name: 'Вклад', bank: 'other', currency: 'RUB',
  openingBalance: toMinor('100000'), openingDate: new Date(Date.now() - 365 * 86_400_000).toISOString(),
  color: '#fff', isArchived: 0, sortOrder: 0,
  interestRate: 10, capitalization: 'none',
  maturityDate: new Date(Date.now() + 365 * 86_400_000).toISOString(),
  createdAt: '', updatedAt: '', deletedAt: null, ...over,
})

const d = depositInfo(deposit({}), toMinor('100000'))!
eq('вклад: срок ещё не истёк', d.matured, false)
eq('вклад: пополняемость читается', d.replenishable, false)
eq('вклад: начислено за год ≈ 10%', Math.round((d.accrued ?? 0) / toMinor('1000')), 10)
eq('вклад: прогноз больше тела', (d.projected ?? 0) > toMinor('100000'), true)
eq('вклад: доход к окончанию положительный', (d.interest ?? 0) > 0, true)

const matured = depositInfo(deposit({ maturityDate: new Date(Date.now() - 86_400_000).toISOString() }), toMinor('100000'))!
eq('истёкший вклад помечен', matured.matured, true)
eq('после окончания проценты не капают', (matured.accrued ?? 0) > 0, true)

const repl = depositInfo(deposit({ isReplenishable: 1 }), toMinor('100000'))!
eq('пополняемый вклад', repl.replenishable, true)

// Без капитализации проценты не капают на тело — сумма меньше, чем при месячной
const simple = depositProjection(deposit({ capitalization: 'none' }), toMinor('100000'))!
const monthly = depositProjection(deposit({ capitalization: 'monthly' }), toMinor('100000'))!
eq('месячная капитализация выгоднее простых процентов', monthly > simple, true)
eq('«в конце срока» — простые проценты', depositProjection(deposit({ capitalization: 'atEnd' }), toMinor('100000')), simple)
eq('не вклад — расчёта нет', depositInfo(deposit({ kind: 'debit' }), 0), null)
eq('без ставки прогноза нет', depositProjection(deposit({ interestRate: undefined }), toMinor('100000')), null)

// ── Подсказки (G6.5) ────────────────────────────────────────────────────────
eq('предиктивные блоки выключены по умолчанию', WIDGETS.filter(w => w.predictive).every(w => DEFAULT_WIDGETS[w.id] === false), true)
eq('фактические блоки включены по умолчанию', WIDGETS.filter(w => !w.predictive).every(w => DEFAULT_WIDGETS[w.id] === true), true)
eq('у каждого блока есть значение по умолчанию', WIDGETS.every(w => typeof DEFAULT_WIDGETS[w.id] === 'boolean'), true)
eq('id блоков уникальны', new Set(WIDGETS.map(w => w.id)).size, WIDGETS.length)

// ── Разрез по профилям (G6.1) ───────────────────────────────────────────────
const profs = [{ id: 'primary', name: 'Я' }, { id: 'p2', name: 'Работник' }]
eq('подпись разреза: вместе', scopeLabel('all', profs, 'Я'), 'весь кабинет')
eq('подпись разреза: только свои', scopeLabel('mine', profs, 'Я'), 'только Я')
eq('подпись разреза: конкретный профиль', scopeLabel('p2', profs, 'Я'), 'Работник')
eq('подпись разреза: удалённый профиль', scopeLabel('нет-такого', profs, 'Я'), 'профиль')

// ── Условия выборки в аналитике ─────────────────────────────────────────────
const {
  applyFilters, countActiveFilters, describeFilters, normalizeFilters, EMPTY_FILTERS,
} = await import('../src/utils/report')

const pool = [
  tx({ categoryId: 'groceries', amount: toMinor('1000'), title: 'Пятёрочка' }),
  tx({ categoryId: 'food', amount: toMinor('500'), title: 'Кафе' }),
  tx({ categoryId: 'transport', amount: toMinor('200'), title: 'Метро' }),
  tx({ categoryId: 'salary', amount: toMinor('9000'), type: 'income', title: 'ЗП' }),
  tx({ categoryId: 'transfer', amount: toMinor('3000'), type: 'transfer', excludeFromStats: 1, title: 'Перевод' }),
]
const pick = (f: Partial<typeof EMPTY_FILTERS>) =>
  applyFilters(pool, { ...EMPTY_FILTERS, ...f }).map(t => t.title).sort()

eq('без условий: переводы скрыты', pick({}), ['ЗП', 'Кафе', 'Метро', 'Пятёрочка'])
eq('только одна категория', pick({ categoryIds: ['groceries'] }), ['Пятёрочка'])
eq('несколько категорий', pick({ categoryIds: ['groceries', 'food'] }), ['Кафе', 'Пятёрочка'])
eq('исключить категорию', pick({ excludeCategoryIds: ['groceries'] }), ['ЗП', 'Кафе', 'Метро'])
eq('исключение сильнее включения', pick({ categoryIds: ['groceries', 'food'], excludeCategoryIds: ['food'] }), ['Пятёрочка'])
eq('только расходы', pick({ types: ['expense'] }), ['Кафе', 'Метро', 'Пятёрочка'])
eq('переводы по запросу', pick({ includeExcluded: true, types: ['transfer'] }), ['Перевод'])
eq('порог суммы снизу', pick({ minAmount: toMinor('600') }), ['ЗП', 'Пятёрочка'])
eq('порог суммы сверху', pick({ maxAmount: toMinor('500') }), ['Кафе', 'Метро'])
eq('поиск по названию', pick({ search: 'метро' }), ['Метро'])
eq('условия складываются', pick({ types: ['expense'], excludeCategoryIds: ['transport'], minAmount: toMinor('600') }), ['Пятёрочка'])

eq('пустые условия не считаются', countActiveFilters(EMPTY_FILTERS), 0)
eq('условия считаются по штукам', countActiveFilters({ ...EMPTY_FILTERS, categoryIds: ['a', 'b'], excludeCategoryIds: ['c'] }), 3)
eq('пробельный поиск за условие не считается', countActiveFilters({ ...EMPTY_FILTERS, search: '   ' }), 0)

const maps = { accounts: [{ id: 'a1', name: 'ВТБ' }], profiles: [{ id: 'p1', name: 'Работник' }] } as never
eq('описание: включение', describeFilters({ ...EMPTY_FILTERS, categoryIds: ['groceries'] }, maps)[0], 'категории: Продукты')
eq('описание: исключение', describeFilters({ ...EMPTY_FILTERS, excludeCategoryIds: ['food'] }, maps)[0], 'без категорий: Кафе и еда')
eq('описание пустых условий пусто', describeFilters(EMPTY_FILTERS, maps).length, 0)

// пресет из прошлой версии не должен ронять фильтрацию отсутствующим полем
const legacyPreset = { types: ['expense'], categoryIds: ['food'] } as never
eq('старый пресет достраивается', normalizeFilters(legacyPreset).excludeCategoryIds, [])
eq('старый пресет работает', applyFilters(pool, normalizeFilters(legacyPreset)).length, 1)

let failed = 0
for (const [name, pass, d2] of checks) { console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${pass ? '' : ' — ' + d2}`); if (!pass) failed++ }
console.log(`\n${checks.length - failed}/${checks.length} проверок ролей, дней, вкладов и подсказок пройдено`)
process.exit(failed ? 1 : 0)
