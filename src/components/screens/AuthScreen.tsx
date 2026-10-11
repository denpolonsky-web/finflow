import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { checkPassword, requestPasswordReset, signIn, signUp } from '../../db/auth'
import { inputCls, primaryBtn } from '../ui/Sheet'
import { supabaseHost } from '../../db/supabase'

type Mode = 'signin' | 'signup' | 'reset'

const STRENGTH_COLORS = ['bg-accent-red', 'bg-accent-red', 'bg-accent-yellow', 'bg-accent-green', 'bg-accent-green']

export function AuthScreen({ onAuthed, onLocalOnly }: { onAuthed: () => void; onLocalOnly?: () => void }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const strength = mode === 'signup' ? checkPassword(password) : null
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canSubmit = mode === 'reset'
    ? emailOk
    : emailOk && password.length > 0 && (mode === 'signin' || strength!.ok)

  async function submit() {
    if (busy || !canSubmit) return
    setBusy(true); setError(null); setInfo(null)
    try {
      if (mode === 'reset') {
        const r = await requestPasswordReset(email)
        if (!r.ok) setError(r.error ?? 'Не получилось')
        else setInfo('Письмо для сброса отправлено — проверьте почту')
        return
      }
      const r = mode === 'signin' ? await signIn(email, password) : await signUp(email, password)
      if (!r.ok) { setError(r.error ?? 'Не получилось войти'); return }
      if (r.needsConfirmation) {
        setInfo('Аккаунт создан. Подтвердите email по ссылке из письма, затем войдите.')
        setMode('signin')
        return
      }
      onAuthed()
    } catch (e) {
      console.error('[auth]', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-bg-primary flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="text-center">
          <div className="text-6xl mb-4">💰</div>
          <h1 className="text-text-primary text-3xl font-bold">FinFlow</h1>
          <p className="text-text-secondary text-sm mt-2">
            {mode === 'signin' && 'Войдите, чтобы данные синхронизировались между устройствами'}
            {mode === 'signup' && 'Создайте аккаунт — ваши финансы будут видны только вам'}
            {mode === 'reset' && 'Отправим ссылку для сброса пароля'}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="email" inputMode="email" autoComplete="email" placeholder="Email"
            value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void submit() }}
            className={inputCls}
          />

          {mode !== 'reset' && (
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder="Пароль"
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void submit() }}
                className={`${inputCls} pr-12`}
              />
              <button type="button" onClick={() => setShow(s => !s)}
                aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted p-1">
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          )}

          {mode === 'signup' && password.length > 0 && strength && (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={`h-1 flex-1 rounded-full ${
                    i < strength.score ? STRENGTH_COLORS[strength.score] : 'bg-bg-card2'}`} />
                ))}
              </div>
              <p className={`text-xs ${strength.ok ? 'text-text-muted' : 'text-accent-yellow'}`}>
                {strength.message}
              </p>
            </div>
          )}

          {error && <p className="text-accent-red text-xs">{error}</p>}
          {info && <p className="text-accent-green text-xs">{info}</p>}

          <button onClick={submit} disabled={!canSubmit || busy} className={`${primaryBtn} flex items-center justify-center gap-2`}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {mode === 'signin' ? 'Войти' : mode === 'signup' ? 'Создать аккаунт' : 'Отправить ссылку'}
          </button>
        </div>

        <div className="flex flex-col gap-2 text-center text-xs">
          {mode === 'signin' && (
            <>
              <button onClick={() => { setMode('signup'); setError(null) }} className="text-accent">
                Нет аккаунта? Зарегистрироваться
              </button>
              <button onClick={() => { setMode('reset'); setError(null) }} className="text-text-muted">
                Забыли пароль?
              </button>
            </>
          )}
          {mode !== 'signin' && (
            <button onClick={() => { setMode('signin'); setError(null) }} className="text-accent">
              ← Назад ко входу
            </button>
          )}
          {onLocalOnly && (
            <button onClick={onLocalOnly} className="text-text-muted mt-2">
              Продолжить без аккаунта (только на этом устройстве)
            </button>
          )}
        </div>

        <p className="text-text-muted text-[11px] text-center leading-relaxed">
          Пароль проверяется и хранится на стороне Supabase в виде bcrypt-хэша.
          В приложение и в базу финансов он не попадает.
        </p>
        {supabaseHost && (
          <p className="text-text-muted/60 text-[10px] text-center">Сервер: {supabaseHost}</p>
        )}
      </div>
    </div>
  )
}
