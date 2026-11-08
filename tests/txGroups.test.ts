import { groupByDay } from '../src/utils/txGroups'
import { monthName, monthTitle, formatDayKey } from '../src/utils/format'
import type { Transaction, TransactionType } from '../src/types'

const checks: [string, boolean, string][] = []
const eq = (name: string, got: unknown, want: unknown) =>
  checks.push([name, JSON.stringify(got) === JSON.stringify(want), `получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`])

let seq = 0

/**
 * Дата собирается из ЛОКАЛЬНЫХ частей и только потом уходит в ISO — ровно так,
 * как её сохраняет приложение. Иначе тест стал бы зависеть от часового пояса
 * машины: `...T00:30:00.000Z` в разных поясах попадает в разные сутки.
 */
function tx(
  y: number, mo: number, d: number, h: number,
  type: TransactionType, amount: number, exclude: 0 | 1 = 0,
): Transaction {
  seq++
  const date = new Date(y, mo - 1, d, h, 0, 0).toISOString()
  return {
    id: `t${seq}`,
    type,
    amount,
    categoryId: 'groceries',
    accountId: 'a1',
    title: `Операция ${seq}`,
    date,
    excludeFromStats: exclude,
    source: 'manual',
    createdAt: date,
    updatedAt: date,
    deletedAt: null,
  }
}

// ── Группировка по дням ──────────────────────────────────────────────────────

eq('пустой список → пусто', groupByDay([]), [])

const simple = groupByDay([
  tx(2026, 11, 7, 12, 'expense', 10_000),
  tx(2026, 11, 7, 9, 'expense', 5_000),
  tx(2026, 11, 5, 10, 'income', 30_000),
])
eq('дней получилось два', simple.length, 2)
eq('первый день — 7 ноября', simple[0].date, '2026-11-07')
eq('во втором дне одна операция', simple[1].items.length, 1)
eq('ключ месяца проставлен', simple[0].month, '2026-11')
eq('итог дня с расходами отрицательный', simple[0].total, -15_000)
eq('итог дня с доходом положительный', simple[1].total, 30_000)

/**
 * Главное: день считается по МЕСТНОМУ времени. Операция, заведённая сразу
 * после полуночи, обязана попасть в сегодняшний день, а не во вчерашний.
 * На срезе ISO-строки этот случай ломался — в Москве 00:30 это ещё вчера по UTC.
 */
const afterMidnight = groupByDay([tx(2026, 11, 7, 0, 'expense', 1_000)])
eq('операция в полночь остаётся в своём дне', afterMidnight[0].date, '2026-11-07')
const beforeMidnight = groupByDay([tx(2026, 11, 7, 23, 'expense', 1_000)])
eq('операция поздно вечером не уезжает на завтра', beforeMidnight[0].date, '2026-11-07')

// Порядок входа сохраняется: сортировать внутри нельзя, иначе догруженный
// кусок бесконечной ленты переехал бы в середину списка
const unsorted = groupByDay([
  tx(2026, 1, 2, 10, 'expense', 100),
  tx(2026, 3, 1, 10, 'expense', 100),
  tx(2026, 2, 1, 10, 'expense', 100),
])
eq('порядок дней не переставляется', unsorted.map(g => g.date), ['2026-01-02', '2026-03-01', '2026-02-01'])

const within = groupByDay([
  tx(2026, 4, 1, 10, 'expense', 1),
  tx(2026, 4, 1, 11, 'expense', 2),
])
eq('порядок операций внутри дня сохранён', within[0].items.map(i => i.amount), [1, 2])

// Исключённые из статистики не влияют на итог, но в списке остаются
const excluded = groupByDay([
  tx(2026, 5, 1, 10, 'expense', 7_000, 1),
  tx(2026, 5, 1, 11, 'expense', 3_000),
])
eq('исключённая операция видна в списке', excluded[0].items.length, 2)
eq('исключённая операция не вошла в итог дня', excluded[0].total, -3_000)

// Перевод не меняет итог: деньги остались внутри кабинета
const transfer = groupByDay([
  tx(2026, 6, 1, 10, 'transfer', 50_000),
  tx(2026, 6, 1, 11, 'expense', 2_000),
])
eq('перевод не влияет на итог дня', transfer[0].total, -2_000)

const zero = groupByDay([
  tx(2026, 7, 1, 10, 'income', 1_000),
  tx(2026, 7, 1, 11, 'expense', 1_000),
])
eq('доход и равный расход дают ноль', zero[0].total, 0)

// ── Названия месяцев и дат ───────────────────────────────────────────────────
// Всё на заведомо прошлых датах: тест не должен зависеть от «сегодня»

eq('месяц в именительном падеже, а не в родительном', monthName(new Date(2026, 10, 7)), 'ноябрь')
eq('январь', monthName(new Date(2026, 0, 15)), 'январь')

eq('заголовок месяца прошлого года — с годом', monthTitle('2020-03'), 'Март 2020')
eq('заголовок месяца текущего года — без года',
  monthTitle(`${new Date().getFullYear()}-01`), 'Январь')
eq('битый ключ месяца не роняет', monthTitle('мусор'), '—')

eq('ключ дня разбирается как локальная дата', formatDayKey('2020-03-05'), '5 марта 2020')

let failed = 0
for (const [name, pass, d] of checks) { console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${pass ? '' : ' — ' + d}`); if (!pass) failed++ }
console.log(`\n${checks.length - failed}/${checks.length} проверок группировки операций и дат пройдено`)
process.exit(failed ? 1 : 0)
