import { supabase, hasSupabase, withTimeout, diagnoseCloud, cloudDisabledReason } from './supabase'
import { isNetworkFailure } from './cloudConfig'
import { getMeta, setMeta, wipeLocal } from './index'
import type { Session, User } from '@supabase/supabase-js'

/**
 * Вход делегирован Supabase Auth (email + пароль). Пароль хэшируется bcrypt на сервере,
 * в бандл и в localStorage не попадает; клиент хранит только JWT, который supabase-js
 * сам обновляет — поэтому вход переживает офлайн.
 *
 * Регистрации и писем (подтверждение, сброс пароля) в приложении сейчас НЕТ:
 * пользователь создаётся вручную в Supabase → Authentication → Users → Add user.
 * Строки в БД защищены RLS по user_id, поэтому вход нужен, чтобы синк работал.
 */

export interface AuthResult {
  ok: boolean
  error?: string
}

function humanError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Неверный email или пароль'
  if (m.includes('email not confirmed')) return 'Email пользователя не подтверждён — в Supabase откройте Authentication → Users и подтвердите вручную'
  if (m.includes('rate limit') || m.includes('too many')) return 'Слишком много попыток входа, подождите немного и повторите'
  return message
}

/**
 * Единая точка превращения ошибки supabase-js в текст для человека.
 * Сетевой сбой («Load failed» в Safari) сам по себе ничего не говорит, поэтому
 * в этом случае делаем пробу сервера и объясняем конкретную причину.
 */
async function explainAuthError(err: { message: string; status?: number }): Promise<string> {
  if (isNetworkFailure(err.message, err.status)) return diagnoseCloud()
  return humanError(err.message)
}

function notConfigured(): AuthResult {
  return { ok: false, error: `Облако не настроено${cloudDisabledReason ? ': ' + cloudDisabledReason : ''}` }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return notConfigured()
  const res = await withTimeout(
    supabase.auth.signInWithPassword({ email: email.trim(), password }),
    15_000, 'signIn',
  )
  if (!res) return { ok: false, error: await diagnoseCloud() }
  if (res.error) return { ok: false, error: await explainAuthError(res.error) }
  await onUserResolved(res.data.user)
  return { ok: true }
}

export async function signOut(): Promise<void> {
  if (supabase) await withTimeout(supabase.auth.signOut(), 8000, 'signOut')
  // локальные данные стираем: иначе следующий пользователь на этом устройстве
  // увидит чужие операции
  await wipeLocal()
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null
  const res = await withTimeout(supabase.auth.getSession(), 8000, 'getSession')
  return res?.data.session ?? null
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

/**
 * Если на устройстве лежат данные другого пользователя — чистим,
 * чтобы не смешать два набора финансов в одной IndexedDB.
 */
export async function onUserResolved(user: User | null): Promise<void> {
  if (!user) return
  const prev = await getMeta('userId')
  if (prev && prev !== user.id) {
    console.warn('[auth] другой пользователь — локальная база очищена')
    await wipeLocal()
  }
  await setMeta('userId', user.id)
}

export { hasSupabase }
