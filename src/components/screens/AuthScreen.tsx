import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { signIn } from '../../db/auth'
import { inputCls, primaryBtn } from '../ui/Sheet'
import { supabaseHost } from '../../db/supabase'

/**
 * Только вход (email + пароль). Регистрации и писем нет: аккаунт создаётся
 * вручную в Supabase → Authentication → Users → Add user.
 */
export function AuthScreen({ onAuthed, onLocalOnly }: { onAuthed: () => void; onLocalOnly?: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canSubmit = emailOk && password.length > 0

  async function submit() {
    if (busy || !canSubmit) return
    setBusy(true); setError(null)
    try {
      const r = await signIn(email, password)
      if (!r.ok) { setError(r.error ?? 'Не получилось войти'); return }
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
            Войдите, чтобы данные синхронизировались между устройствами
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="email" inputMode="email" autoComplete="email" placeholder="Email"
            value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void submit() }}
            className={inputCls}
          />

          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
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

          {error && <p className="text-accent-red text-xs">{error}</p>}

          <button onClick={submit} disabled={!canSubmit || busy} className={`${primaryBtn} flex items-center justify-center gap-2`}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            Войти
          </button>
        </div>

        {onLocalOnly && (
          <button onClick={onLocalOnly} className="text-text-muted text-xs">
            Продолжить без аккаунта (только на этом устройстве)
          </button>
        )}

        {supabaseHost && (
          <p className="text-text-muted/60 text-[10px] text-center">Сервер: {supabaseHost}</p>
        )}
      </div>
    </div>
  )
}
