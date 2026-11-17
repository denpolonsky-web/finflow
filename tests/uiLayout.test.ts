import {
  normalizeList, loadChartModes, DEFAULT_CHART_MODES,
  NAV_TABS, DEFAULT_NAV, STATS_VIEWS, DEFAULT_STATS_VIEWS,
  PERIOD_OPTIONS, DEFAULT_PERIODS, DEFAULT_AMOUNT_COLORS, loadAmountColors,
} from '../src/utils/uiPrefs'
import { timeSeries, monthlyTotals, topExpenses, inBucket, SERIES_DAY_LIMIT } from '../src/utils/analytics'
import { getRange } from '../src/utils/period'
import { toMinor } from '../src/utils/money'
import type { Transaction } from '../src/types'

const checks: [string, boolean, string][] = []
const eq = (name: string, got: unknown, want: unknown) =>
  checks.push([name, JSON.stringify(got) === JSON.stringify(want), `получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`])

// В Node нет localStorage, а настройки его читают: загрузка обязана пережить это
// и вернуть значения по умолчанию, а не упасть.
eq('без localStorage цвета берутся по умолчанию', loadAmountColors(), DEFAULT_AMOUNT_COLORS)
eq('без localStorage виды графиков по умолчанию', loadChartModes(), DEFAULT_CHART_MODES)
eq('цвет по категории по умолчанию выключен', DEFAULT_AMOUNT_COLORS.byCategory, false)

// ── Списки «что показывать» ─────────────────────────────────────────────────

const navIds = NAV_TABS.map(t => t.id)
const viewIds = STATS_VIEWS.map(v => v.id)

eq('ничего не сохранено — значение по умолчанию', normalizeList(null, navIds, DEFAULT_NAV), DEFAULT_NAV)
// закреплённый пункт можно подвинуть — нельзя только выключить
eq('порядок сохранённого уважается',
  normalizeList(['stats', 'home'], navIds, DEFAULT_NAV, ['home']), ['stats', 'home'])
eq('незнакомый пункт из старой версии отброшен',
  normalizeList(['home', 'выдумка', 'stats'], navIds, DEFAULT_NAV, ['home']), ['home', 'stats'])
eq('дубли схлопнуты',
  normalizeList(['stats', 'stats'], navIds, DEFAULT_NAV, ['home']), ['home', 'stats'])
eq('закреплённый пункт возвращается, даже если его убрали из хранилища',
  normalizeList(['stats'], navIds, DEFAULT_NAV, ['home'])[0], 'home')
eq('пустой список — не тупик: берём значение по умолчанию',
  normalizeList([], viewIds, DEFAULT_STATS_VIEWS), DEFAULT_STATS_VIEWS)
eq('мусор вместо массива не роняет',
  normalizeList({ nav: 'home' }, navIds, DEFAULT_NAV), DEFAULT_NAV)

eq('все значения по умолчанию есть в реестре навигации', DEFAULT_NAV.every(id => navIds.includes(id)), true)
eq('все значения по умолчанию есть в реестре разделов', DEFAULT_STATS_VIEWS.every(id => viewIds.includes(id)), true)
eq('все значения по умолчанию есть в реестре периодов',
  DEFAULT_PERIODS.every(id => PERIOD_OPTIONS.some(p => p.id === id)), true)
eq('id вкладок уникальны', new Set(navIds).size, navIds.length)
eq('id разделов уникальны', new Set(viewIds).size, viewIds.length)
eq('у каждого раздела есть подпись и пояснение',
  STATS_VIEWS.every(v => v.label.length > 0 && v.hint.length > 0), true)

// ── Ряд для графика ─────────────────────────────────────────────────────────

/** Локальная дата: ряд группирует по местному дню, `...Z` зависел бы от пояса. */
const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).toISOString()

const tx = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2), type: 'expense', amount: toMinor('100'),
  categoryId: 'food', accountId: 'a', title: '', date: at(2026, 3, 10),
  excludeFromStats: 0, source: 'manual', createdAt: '', updatedAt: '', deletedAt: null, ...over,
})

// именно 'custom': у 'month' границы всегда от текущей даты, аргументы он не читает
const march = getRange('custom', 0, '2026-03-01', '2026-03-31')
const monthSeries = timeSeries([
  tx({ date: at(2026, 3, 1), amount: toMinor('500') }),
  tx({ date: at(2026, 3, 1), amount: toMinor('300') }),
  tx({ date: at(2026, 3, 5), type: 'income', amount: toMinor('1000') }),
], march)

eq('месяц показываем по дням', monthSeries.step, 'day')
eq('шкала непрерывная, пустые дни на месте', monthSeries.points.length, 31)
eq('расходы одного дня сложены', monthSeries.points[0].expense, toMinor('800'))
eq('доход попал в свой день', monthSeries.points[4].income, toMinor('1000'))
eq('накопление не сбрасывается в пустые дни', monthSeries.points[30].cumulative, toMinor('800'))

const year = getRange('year', 0)
const yearSeries = timeSeries([tx({ date: at(new Date().getFullYear(), 2, 10) })], year)
eq('год группируется по месяцам', yearSeries.step, 'month')
eq('в году двенадцать точек', yearSeries.points.length, 12)
eq('порог переключения — квартал с небольшим', SERIES_DAY_LIMIT > 92 && SERIES_DAY_LIMIT < 120, true)

// ── Принадлежность операции точке ───────────────────────────────────────────

eq('операция попадает в свой день', inBucket(tx({ date: at(2026, 3, 7) }), '2026-03-07'), true)
eq('тот же ключ раскрывает и месяц', inBucket(tx({ date: at(2026, 3, 7) }), '2026-03'), true)
eq('чужой день не засчитан', inBucket(tx({ date: at(2026, 3, 7) }), '2026-03-08'), false)
eq('ночная операция остаётся в своём местном дне',
  inBucket(tx({ date: at(2026, 3, 7, 0) }), '2026-03-07'), true)
eq('поздняя вечерняя не уезжает на завтра',
  inBucket(tx({ date: at(2026, 3, 7, 23) }), '2026-03-07'), true)

// ── Итоги по месяцам ────────────────────────────────────────────────────────

const now = new Date(2026, 10, 14)            // 14 ноября 2026
const mt = monthlyTotals([
  tx({ date: at(2026, 11, 2), amount: toMinor('400') }),
  tx({ date: at(2026, 9, 2), amount: toMinor('100') }),
  tx({ date: at(2026, 11, 3), type: 'income', amount: toMinor('5000') }),
  tx({ date: at(2025, 1, 1), amount: toMinor('999') }),     // вне окна
  tx({ date: at(2026, 11, 4), amount: toMinor('700'), excludeFromStats: 1 }),  // перевод
], 6, now)

eq('окно ровно в шесть месяцев', mt.length, 6)
eq('последний месяц — текущий', mt[5].key, '2026-11')
eq('расход текущего месяца', mt[5].expense, toMinor('400'))
eq('доход текущего месяца', mt[5].income, toMinor('5000'))
eq('месяц без операций остаётся нулём', mt[4].expense, 0)
eq('операция вне окна не учтена', mt.reduce((s, m) => s + m.expense, 0), toMinor('500'))
eq('перевод в статистику не идёт', mt[5].expense, toMinor('400'))
eq('подпись месяца без года, пока год текущий', mt[5].label, 'ноя')

const mtYear = monthlyTotals([], 12, now)
eq('на длинном окне у прошлогодних месяцев есть год', mtYear[0].label, 'дек 25')

// ── Крупнейшие траты ────────────────────────────────────────────────────────

const pool = [
  tx({ id: 'b', amount: toMinor('500') }),
  tx({ id: 'a', amount: toMinor('500') }),
  tx({ id: 'c', amount: toMinor('900') }),
  tx({ id: 'd', amount: toMinor('5000'), excludeFromStats: 1 }),
  tx({ id: 'e', type: 'income', amount: toMinor('9000') }),
]
eq('по убыванию суммы', topExpenses(pool, 3).map(t => t.id), ['c', 'a', 'b'])
eq('тай-брейк по id — порядок не плавает', topExpenses(pool, 3)[1].id, 'a')
eq('переводы и доходы не считаются тратами', topExpenses(pool, 10).length, 3)
eq('предел уважается', topExpenses(pool, 1).length, 1)

let failed = 0
for (const [name, pass, d] of checks) { console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${pass ? '' : ' — ' + d}`); if (!pass) failed++ }
console.log(`\n${checks.length - failed}/${checks.length} проверок настроек отображения и рядов для графиков пройдено`)
process.exit(failed ? 1 : 0)
