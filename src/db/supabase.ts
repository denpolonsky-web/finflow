import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const configured = Boolean(url && key && url.startsWith('http'))

export const supabase: SupabaseClient | null = configured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,        // сессия переживает перезагрузку → офлайн-вход работает
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'finflow.auth',
      },
    })
  : null

/** true — облако настроено. Значение вычисляется на СБОРКЕ (Vite инлайнит env). */
export const hasSupabase = configured

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
