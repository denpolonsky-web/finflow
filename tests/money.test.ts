import 'fake-indexeddb/auto'
import { toMinor, toMajor, minorToInput, groupMoney, sanitizeMoneyInput } from '../src/utils/money'
import { buildPlan, MIN_RATE_DAYS } from '../src/db/goals'
import { getRange } from '../src/utils/period'
import { dateInputToIso, isoDateOnly } from '../src/utils/format'
import { reportTotal } from '../src/utils/report'
import type { Goal } from '../src/types'

const checks: [string, boolean, string][] = []
const eq = (name: string, got: unknown, want: unknown) =>
  checks.push([name, JSON.stringify(got) === JSON.stringify(want), `получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`])

// ── toMinor: округление копеек ────────────────────────────────────────────────
// Math.round(1.005 * 100) = 100, потому что 1.005 хранится как 1.00499999999999989
eq('1,005 → 101 копейка (не 100)', toMinor('1,005'), 101)
eq('8,165 → 817 копеек', toMinor('8,165'), 817)
eq('обычная сумма', toMinor('1234,56'), 123456)
eq('точка как запятая', toMinor('1234.56'), 123456)
eq('целое', toMinor('1000'), 100000)
eq('пусто → 0', toMinor(''), 0)
eq('мусор → 0', toMinor('abc'), 0)
eq('число на входе', toMinor(1234.56), 123456)
eq('Infinity → 0', toMinor(Number.POSITIVE_INFINITY), 0)
eq('копейки туда-обратно', toMajor(toMinor('99,99')), 99.99)

// Разрядка не должна ломать разбор: поле отдаёт строку с неразрывными пробелами
eq('разрядка с неразрывным пробелом разбирается', toMinor('1 234 567,89'), 123456789)
eq('обычные пробелы тоже', toMinor('1 234 567'), 123456700)

// ── Ввод денег ───────────────────────────────────────────────────────────────
eq('разрядка: 1000', groupMoney('1000'), '1 000')
eq('разрядка: 1000000', groupMoney('1000000'), '1 000 000')
eq('разрядка: 10 остаётся 10', groupMoney('10'), '10')
eq('разрядка не трогает копейки', groupMoney('1234,5'), '1 234,5')
eq('разрядка пустой строки', groupMoney(''), '')

eq('ввод: буквы отбрасываются', sanitizeMoneyInput('12ab3'), '123')
eq('ввод: точка → запятая', sanitizeMoneyInput('12.5'), '12,5')
eq('ввод: только одна запятая', sanitizeMoneyInput('1,2,3'), '1,23')
eq('ввод: не больше двух знаков после запятой', sanitizeMoneyInput('1,2345'), '1,23')
eq('ввод: не больше 12 цифр в целой части', sanitizeMoneyInput('1234567890123456').length, 12)
eq('ввод: разрядка снимается при повторном вводе', sanitizeMoneyInput('1 000'), '1000')

eq('копейки → поле: без копеек', minorToInput(100000), '1000')
eq('копейки → поле: с копейками', minorToInput(123456), '1234,56')
eq('копейки → поле: ведущий ноль в копейках', minorToInput(100005), '1000,05')
eq('копейки → поле: null', minorToInput(null), '')

// ── Темп цели: не считаем от баланса привязанного счёта ──────────────────────
const goal = (over: Partial<Goal>): Goal => ({
  id: 'g', title: 'Цель', icon: '🎯', kind: 'save',
  targetAmount: 10_000_000, fundingAccountId: null, manualAmount: 0,
  isArchived: 0, createdAt: new Date().toISOString(), completedAt: null,
  updatedAt: new Date().toISOString(), deletedAt: null, ...over,
})
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

// Новая цель на счёте, где уже лежат деньги: темпа быть не должно
const fresh = buildPlan(goal({ createdAt: daysAgo(1), startAmount: 5_000_000 }), 5_000_000)
eq('свежая цель: темп не выдумывается', fresh.actualMonthly, null)
eq('свежая цель: статус too-early', fresh.status, 'too-early')
eq('свежая цель: прогноза даты нет', fresh.projectedDate, null)

// Стартовая сумма в темп не попадает
const grown = buildPlan(goal({ createdAt: daysAgo(30), startAmount: 5_000_000 }), 6_000_000)
eq('темп считается от прироста, а не от всего баланса', grown.actualMonthly, Math.round((1_000_000 / 30) * 30.44))

// База неизвестна (цель из старой версии) — темп честно не показываем
const legacy = buildPlan(goal({ createdAt: daysAgo(60), startAmount: undefined }), 3_000_000)
eq('без стартовой суммы темпа нет', legacy.actualMonthly, null)

// Прогресс и достижение считаются как раньше
eq('процент выполнения', buildPlan(goal({ startAmount: 0 }), 2_500_000).pct, 25)
eq('цель достигнута', buildPlan(goal({ startAmount: 0 }), 10_000_000).status, 'done')
eq('порог расчёта темпа задан', MIN_RATE_DAYS > 0, true)

// ── Даты: границы периода и date-only поля ───────────────────────────────────
const custom = getRange('custom', 0, '2026-03-10', '2026-03-20')
eq('произвольный период: начало — локальная полночь', custom.from.getHours(), 0)
eq('произвольный период: начало 10 марта', custom.from.getDate(), 10)
eq('произвольный период: конец 20 марта', custom.to.getDate(), 20)
eq('произвольный период: конец в 23:59', custom.to.getHours(), 23)

// Дата из <input type="date"> не должна уезжать на день при показе
eq('date-only: туда и обратно без сдвига', isoDateOnly(dateInputToIso('2026-12-31')), '2026-12-31')
eq('date-only: начало года', isoDateOnly(dateInputToIso('2026-01-01')), '2026-01-01')
eq('date-only: пусто → null', dateInputToIso(''), null)

// Месячные периоды не должны схлопываться
const month = getRange('month', 0)
eq('месяц: начало раньше конца', month.from.getTime() < month.to.getTime(), true)

// ── Средний чек взвешивается по расходным операциям ──────────────────────────
const rows = [
  { key: 'a', label: 'A', color: '#000', value: 10_000, count: 10, expenseCount: 1, share: 0, delta: null },
  { key: 'b', label: 'B', color: '#000', value: 20_000, count: 1, expenseCount: 1, share: 0, delta: null },
]
eq('средний чек: вес — число расходных операций', reportTotal(rows, 'avg'), 15_000)
eq('сумма расходов складывается', reportTotal(rows, 'expense'), 30_000)

// ── Новая операция не остаётся «ничьей» ──────────────────────────────────────
// Когда профиль в кабинете один, он выбирается автоматически и в localStorage
// ничего не пишется. Раньше операция сохранялась с profileId: null, и стоило
// завести второй профиль — вся прошлая история становилась ничьей.
const { db } = await import('../src/db')
const { ensureDefaultProfile, resolveProfileId } = await import('../src/db/profiles')
const { createAccount } = await import('../src/db/accounts')
const { addTransaction } = await import('../src/db/transactions')

const primary = await ensureDefaultProfile('Тест')
eq('единственный профиль определяется без localStorage', await resolveProfileId(), primary.id)

const acc = await createAccount({ kind: 'debit', name: 'Счёт', bank: 'other', openingBalance: toMinor('1000') })
const saved = await addTransaction({
  type: 'expense', amount: toMinor('100'), categoryId: 'groceries', accountId: acc.id, title: 'Проверка',
})
eq('операция получила профиль, а не null', saved.profileId, primary.id)
eq('операция попала в базу с профилем', (await db.transactions.get(saved.id))?.profileId, primary.id)

let failed = 0
for (const [name, pass, d] of checks) { console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${pass ? '' : ' — ' + d}`); if (!pass) failed++ }
console.log(`\n${checks.length - failed}/${checks.length} проверок денег, целей и дат пройдено`)
process.exit(failed ? 1 : 0)
