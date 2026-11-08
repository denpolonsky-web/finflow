import 'fake-indexeddb/auto'
import { pushDecision, type PushOutcome } from '../src/db/sync'

const checks: [string, boolean, string][] = []
const eq = (name: string, got: unknown, want: unknown) =>
  checks.push([name, JSON.stringify(got) === JSON.stringify(want), `получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`])

const kind = (res: PushOutcome | null) => pushDecision(res).kind

// ── Главный инвариант ────────────────────────────────────────────────────────
// `withTimeout` возвращает null и при таймауте, и при брошенном исключении.
// Раньше null попадал в ветку «успех», запись удалялась из очереди и изменение
// не уезжало в облако никогда. null — всегда неудача.
eq('таймаут/исключение — это НЕ отправлено', kind(null) === 'sent', false)
eq('таймаут/исключение — это retry', kind(null), 'retry')
eq('у retry есть человекочитаемая причина', pushDecision(null).kind === 'retry'
  && (pushDecision(null) as { message: string }).message.length > 0, true)

// ── Успех ────────────────────────────────────────────────────────────────────
eq('успех', kind({ ok: true }), 'sent')

// ── Отказ сервера по содержимому: считается в MAX_RETRIES → dead ─────────────
eq('нарушение RLS — отказ сервера', kind({ ok: false, message: 'new row violates row-level security policy' }), 'rejected')
eq('битый payload — отказ сервера', kind({ ok: false, message: 'invalid input syntax for type bigint' }), 'rejected')

// ── Сетевой сбой в ответе: в dead уводить нельзя ─────────────────────────────
// Иначе пара обрывов связи похоронит нормальные изменения окончательно.
eq('Safari «Load failed» — retry, не rejected', kind({ ok: false, message: 'Load failed' }), 'retry')
eq('Chrome «Failed to fetch» — retry, не rejected', kind({ ok: false, message: 'Failed to fetch' }), 'retry')
eq('сетевая ошибка никогда не sent', kind({ ok: false, message: 'Load failed' }) === 'sent', false)

// ── Ни один исход не теряется ────────────────────────────────────────────────
const all: (PushOutcome | null)[] = [null, { ok: true }, { ok: false, message: 'Load failed' }, { ok: false, message: 'boom' }]
eq('у каждого исхода есть решение', all.every(r => ['sent', 'retry', 'rejected'].includes(kind(r))), true)

let failed = 0
for (const [name, pass, d] of checks) { console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${pass ? '' : ' — ' + d}`); if (!pass) failed++ }
console.log(`\n${checks.length - failed}/${checks.length} проверок синхронизации пройдено`)
process.exit(failed ? 1 : 0)
