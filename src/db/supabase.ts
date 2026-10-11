import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseCloudConfig, explainProbe, type ProbeOutcome } from './cloudConfig'

const parsed = parseCloudConfig(
  import.meta.env.VITE_SUPABASE_URL as string | undefined,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
)

if (parsed.ok) {
  for (const n of parsed.config.notes) console.warn('[cloud] поправлено автоматически:', n)
  console.info('[cloud] сервер:', parsed.config.host)
} else {
  console.warn('[cloud] облако выключено:', parsed.reason)
}

export const supabase: SupabaseClient | null = parsed.ok
  ? createClient(parsed.config.url, parsed.config.key, {
      auth: {
        persistSession: true,        // сессия переживает перезагрузку → офлайн-вход работает
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'finflow.auth',
      },
    })
  : null

/** Адрес сервера (не секрет — он и так в бандле). Показываем на экране входа. */
export const supabaseHost: string | null = parsed.ok ? parsed.config.host : null

/** Почему облако выключено (для диагностики), null — если включено. */
export const cloudDisabledReason: string | null = parsed.ok ? null : parsed.reason

/** true — облако настроено. Значение вычисляется на СБОРКЕ (Vite инлайнит env). */
export const hasSupabase = parsed.ok

/**
 * Любой сетевой вызов, который может не ответить, оборачиваем этим.
 * Главная причина мёртвой кнопки «Начать» в прошлой версии: у supabase-js
 * нет таймаута, и зависший запрос подвешивал await навсегда.
 */
export function withTimeout<T>(p: Promise<T>, ms = 8000, label = 'request'): Promise<T | null> {
  return Promise.race([
    p.catch(e => { console.error(`[${label}]`, e); return null }),
    new Promise<null>(res => setTimeout(() => {
      console.warn(`[timeout ${ms}ms] ${label}`)
      res(null)
    }, ms)),
  ])
}

/**
 * Проба доступности сервера: отличает «нет интернета» / «сервер недоступен из этой сети» /
 * «ключ отклонён». Вызывается только когда реальный запрос уже упал.
 */
export async function diagnoseCloud(timeoutMs = 6000): Promise<string> {
  if (!parsed.ok) return `Облако не настроено: ${parsed.reason}`
  const { url, key, host } = parsed.config
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let outcome: ProbeOutcome
  try {
    const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, signal: ctrl.signal })
    outcome = { reachable: true, status: r.status }
  } catch {
    outcome = { reachable: false }
  } finally {
    clearTimeout(timer)
  }
  return explainProbe(outcome, host, navigator.onLine)
}
