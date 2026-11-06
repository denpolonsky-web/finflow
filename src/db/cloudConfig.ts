/**
 * Разбор и нормализация переменных окружения Supabase.
 * Чистые функции без побочных эффектов — покрыты тестами (tests/cloudConfig.test.ts).
 *
 * Зачем: «Load failed» в Safari — это любой упавший fetch. Самые частые причины
 * на практике — не сетевые, а ошибки в значениях переменных на Vercel:
 *   • кавычки или пробел/перенос строки вокруг значения;
 *   • в URL вставлен адрес дашборда (supabase.com/dashboard/project/…), а не API;
 *   • в URL остался путь /rest/v1/ или завершающий слэш;
 *   • адрес без https://.
 */

export interface CloudConfig {
  url: string
  key: string
  host: string
  /** что мы молча поправили — пишем в консоль, чтобы было видно */
  notes: string[]
}

export type CloudConfigResult =
  | { ok: true; config: CloudConfig }
  | { ok: false; reason: string }

function clean(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim().replace(/^["'`]+|["'`]+$/g, '').trim()
}

export function parseCloudConfig(rawUrl: unknown, rawKey: unknown): CloudConfigResult {
  const notes: string[] = []
  const urlIn = clean(rawUrl)
  // JWT и sb_publishable_* не содержат пробелов — любые пробелы/переводы строк это мусор
  const keyIn = clean(rawKey).replace(/\s+/g, '')

  if (!urlIn && !keyIn) return { ok: false, reason: 'переменные окружения не заданы' }
  if (!urlIn) return { ok: false, reason: 'не задан VITE_SUPABASE_URL' }
  if (!keyIn) return { ok: false, reason: 'не задан VITE_SUPABASE_ANON_KEY' }

  let candidate = urlIn
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = 'https://' + candidate
    notes.push('к VITE_SUPABASE_URL добавлен https://')
  }

  let u: URL
  try { u = new URL(candidate) } catch {
    return { ok: false, reason: 'VITE_SUPABASE_URL не похож на адрес' }
  }

  // Адрес дашборда вместо адреса API
  if (/(^|\.)supabase\.com$/i.test(u.hostname)) {
    const m = u.pathname.match(/\/project\/([a-z0-9]{15,30})/i)
    if (!m) {
      return {
        ok: false,
        reason: 'в VITE_SUPABASE_URL указан адрес дашборда; нужен адрес вида https://<ref>.supabase.co (Project Settings → API)',
      }
    }
    notes.push('VITE_SUPABASE_URL указывал на дашборд — адрес API восстановлен из ref проекта')
    u = new URL(`https://${m[1].toLowerCase()}.supabase.co`)
  }

  if (u.origin !== candidate.replace(/\/+$/, '')) {
    notes.push('из VITE_SUPABASE_URL убраны путь/слэш')
  }

  return { ok: true, config: { url: u.origin, key: keyIn, host: u.host, notes } }
}

export interface ProbeOutcome {
  /** сервер ответил хоть как-то (даже 401) */
  reachable: boolean
  status?: number
}

/** Человекочитаемое объяснение по результату пробы. */
export function explainProbe(outcome: ProbeOutcome, host: string, online: boolean): string {
  if (!online) return 'Нет интернета. Проверьте подключение и попробуйте снова'
  if (!outcome.reachable) {
    return `Не удаётся связаться с ${host}. Возможные причины: сервер заблокирован в вашей сети (включите VPN), `
      + 'проект Supabase на паузе (Dashboard → Restore), либо в VITE_SUPABASE_URL на Vercel опечатка'
  }
  if (outcome.status === 401 || outcome.status === 403) {
    return 'Сервер отклонил ключ. Проверьте VITE_SUPABASE_ANON_KEY на Vercel (нужен anon / publishable key) и сделайте Redeploy'
  }
  return `Сервер ${host} доступен (код ${outcome.status}), но запрос не прошёл. Попробуйте ещё раз`
}

/** Сообщение supabase-js/браузера о сетевом сбое (Safari: «Load failed», Chrome: «Failed to fetch»). */
export function isNetworkFailure(message: string, status?: number): boolean {
  const m = message.toLowerCase()
  return status === 0
    || m.includes('load failed')
    || m.includes('failed to fetch')
    || m.includes('networkerror')
    || m.includes('network request failed')
    || m.includes('fetch')
    || m.includes('network')
}
