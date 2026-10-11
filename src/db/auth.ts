import { supabase, hasSupabase, withTimeout, diagnoseCloud, cloudDisabledReason } from './supabase'
import { isNetworkFailure } from './cloudConfig'
import { getMeta, setMeta, wipeLocal } from './index'
import type { Session, User } from '@supabase/supabase-js'

/**
 * Авторизация целиком делегирована Supabase Auth.
 * Пароль уходит по TLS и хэшируется bcrypt НА СЕРВЕРЕ — в нашу БД он не попадает,
 * в бандл не попадает, в localStorage не попадает. Клиент хранит только JWT,
 * который supabase-js сам обновляет; поэтому вход переживает офлайн.
 *
 * Своей проверки пароля здесь принципиально нет: самодельная аутентификация —
 * это почти гарантированная дыра (хэширование, брутфорс, восстановление, токены).
 */

const MIN_LENGTH = 10

/** Короткий список самых частых паролей — отсекает очевидное до обращения к серверу. */
const COMMON = new Set([
  'password', 'password1', 'qwerty123', '123456789', '1234567890', 'qwertyuiop',
  'iloveyou1', 'adminadmin', 'letmein123', 'welcome123', 'passw0rd!', 'qazwsxedc',
  'football11', 'superman1', 'trustno1!', 'monkey1234', 'dragon1234', 'baseball1',
])

export interface PasswordCheck {
  ok: boolean
  score: 0 | 1 | 2 | 3 | 4
  message: string
}

export function checkPassword(pw: string): PasswordCheck {
  if (pw.length < MIN_LENGTH) {
    return { ok: false, score: 0, message: `Минимум ${MIN_LENGTH} символов (сейчас ${pw.length})` }
  }
  if (COMMON.has(pw.toLowerCase())) {
    return { ok: false, score: 0, message: 'Этот пароль слишком распространён' }
  }
  if (/^(.)\1+$/.test(pw)) {
    return { ok: false, score: 0, message: 'Пароль из одного повторяющегося символа' }
  }
  let score = 0
  if (/[a-zа-я]/.test(pw)) score++
  if (/[A-ZА-Я]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^\w\s]/.test(pw)) score++
  if (pw.length >= 16) score = Math.min(4, score + 1)

  const labels = ['Очень слабый', 'Слабый', 'Средний', 'Хороший', 'Надёжный'] as const
  return {
    ok: score >= 2,
    score: Math.min(4, score) as PasswordCheck['score'],
    message: score < 2
      ? 'Добавьте цифры, заглавные буквы или символы'
      : labels[Math.min(4, score)],
  }
}

export interface AuthResult {
  ok: boolean
  error?: string
  needsConfirmation?: boolean
}

function humanError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Неверный email или пароль'
  if (m.includes('email not confirmed')) return 'Email не подтверждён — проверьте почту'
  if (m.includes('user already registered')) return 'Такой email уже зарегистрирован'
  if (m.includes('rate limit') || m.includes('too many')) return 'Слишком много попыток, подождите минуту'
  if (m.includes('password')) return 'Пароль не принят сервером: ' + message
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

export async function signUp(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return notConfigured()
  const check = checkPassword(password)
  if (!check.ok) return { ok: false, error: check.message }

  const res = await withTimeout(
    supabase.auth.signUp({ email: email.trim(), password }),
    15_000, 'signUp',
  )
  if (!res) return { ok: false, error: await diagnoseCloud() }
  if (res.error) return { ok: false, error: await explainAuthError(res.error) }

  // если в проекте включено подтверждение email — сессии ещё нет
  if (!res.data.session) return { ok: true, needsConfirmation: true }
  await onUserResolved(res.data.user)
  return { ok: true }
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!supabase) return notConfigured()
  const res = await withTimeout(
    supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin }),
    15_000, 'reset',
  )
  if (!res) return { ok: false, error: await diagnoseCloud() }
  if (res.error) return { ok: false, error: await explainAuthError(res.error) }
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
