import { parseCloudConfig, explainProbe, isNetworkFailure } from '../src/db/cloudConfig'

const checks: [string, boolean, string?][] = []
const eq = (name: string, got: unknown, want: unknown) =>
  checks.push([name, JSON.stringify(got) === JSON.stringify(want), `получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`])

const KEY = 'eyJhbGciOiJIUzI1NiJ9.payload.sig'
const ok = (u: unknown, k: unknown = KEY) => {
  const r = parseCloudConfig(u, k)
  return r.ok ? r.config.url : `ERR:${r.reason}`
}

eq('обычный адрес', ok('https://abcdefghij.supabase.co'), 'https://abcdefghij.supabase.co')
eq('слэш в конце', ok('https://abcdefghij.supabase.co/'), 'https://abcdefghij.supabase.co')
eq('путь /rest/v1/', ok('https://abcdefghij.supabase.co/rest/v1/'), 'https://abcdefghij.supabase.co')
eq('кавычки и пробелы', ok('  "https://abcdefghij.supabase.co"\n'), 'https://abcdefghij.supabase.co')
eq('без https', ok('abcdefghij.supabase.co'), 'https://abcdefghij.supabase.co')
eq('адрес дашборда → адрес API', ok('https://supabase.com/dashboard/project/abcdefghijklmnopqrst'), 'https://abcdefghijklmnopqrst.supabase.co')
eq('дашборд без ref → ошибка', ok('https://supabase.com/dashboard').startsWith('ERR:'), true)
const empty = parseCloudConfig(undefined, undefined)
eq('пусто → ошибка', empty.ok ? null : empty.reason, 'переменные окружения не заданы')
eq('нет ключа → ошибка', ok('https://a.supabase.co', ''), 'ERR:не задан VITE_SUPABASE_ANON_KEY')
eq('мусор вместо адреса → ошибка', ok('http://').startsWith('ERR:'), true)

const k = parseCloudConfig('https://a.supabase.co', `  "${KEY}"\n`)
eq('ключ: кавычки и перевод строки убраны', k.ok ? k.config.key : null, KEY)
const kk = parseCloudConfig('https://a.supabase.co', 'eyJ abc\ndef')
eq('ключ: пробелы внутри убраны', kk.ok ? kk.config.key : null, 'eyJabcdef')
const n = parseCloudConfig('https://a.supabase.co/rest/v1/', KEY)
eq('поправки попадают в notes', n.ok ? n.config.notes.length : -1, 1)

eq('Safari «Load failed»', isNetworkFailure('Load failed'), true)
eq('Chrome «Failed to fetch»', isNetworkFailure('Failed to fetch'), true)
eq('status 0', isNetworkFailure('x', 0), true)
eq('обычная ошибка — не сеть', isNetworkFailure('Invalid login credentials', 400), false)

eq('проба: нет интернета', explainProbe({ reachable: false }, 'h', false).startsWith('Нет интернета'), true)
eq('проба: сервер недоступен', explainProbe({ reachable: false }, 'h.supabase.co', true).includes('h.supabase.co'), true)
eq('проба: ключ отклонён', explainProbe({ reachable: true, status: 401 }, 'h', true).includes('ключ'), true)

let failed = 0
for (const [name, pass, d] of checks) { console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${pass ? '' : ' — ' + d}`); if (!pass) failed++ }
console.log(`\n${checks.length - failed}/${checks.length} проверок конфигурации пройдено`)
process.exit(failed ? 1 : 0)
