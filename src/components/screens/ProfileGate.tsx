import { useState } from 'react'
import { Lock, Loader2, ChevronLeft } from 'lucide-react'
import { checkPin } from '../../db/profiles'
import { useProfile } from '../../store/ProfileContext'
import { inputCls, primaryBtn } from '../ui/Sheet'
import type { Profile } from '../../types'

/** Выбор подпрофиля при входе. Пин-код — опциональный, задаётся в настройках. */
export function ProfileGate() {
  const { profiles, selectProfile } = useProfile()
  const [pending, setPending] = useState<Profile | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function pick(p: Profile) {
    if (!p.pinHash) { selectProfile(p.id); return }
    setPending(p); setPin(''); setError(null)
  }

  async function submitPin() {
    if (!pending || busy) return
    setBusy(true); setError(null)
    try {
      if (await checkPin(pending, pin)) selectProfile(pending.id)
      else setError('Неверный пин-код')
    } finally {
      setBusy(false)
    }
  }

  if (pending) {
    return (
      <div className="min-h-dvh bg-bg-primary flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm flex flex-col gap-5">
          <button onClick={() => setPending(null)}
            className="text-text-muted text-sm flex items-center gap-1 self-start">
            <ChevronLeft size={15} /> Назад
          </button>
          <div className="text-center">
            <div className="text-6xl mb-3">{pending.emoji}</div>
            <h1 className="text-text-primary text-2xl font-bold">{pending.name}</h1>
            <p className="text-text-secondary text-sm mt-1 flex items-center justify-center gap-1.5">
              <Lock size={13} /> Профиль защищён пин-кодом
            </p>
          </div>
          <input
            type="password" inputMode="numeric" autoFocus placeholder="Пин-код"
            value={pin} onChange={e => { setPin(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') void submitPin() }}
            className={`${inputCls} text-center tracking-[0.4em] text-lg`}
          />
          {error && <p className="text-accent-red text-xs text-center">{error}</p>}
          <button onClick={() => void submitPin()} disabled={!pin || busy}
            className={`${primaryBtn} flex items-center justify-center gap-2`}>
            {busy && <Loader2 size={16} className="animate-spin" />} Войти
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-bg-primary flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-text-primary text-2xl font-bold">Кто пользуется?</h1>
          <p className="text-text-secondary text-sm mt-1">Счета общие, статистика — по каждому отдельно</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {profiles.map(p => (
            <button key={p.id} onClick={() => void pick(p)}
              className="flex flex-col items-center gap-2 py-6 rounded-2xl bg-bg-card border border-border active:scale-[.98] transition-transform">
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-3xl"
                style={{ background: `${p.color}22` }}>
                {p.emoji}
              </div>
              <p className="text-text-primary text-sm font-semibold">{p.name}</p>
              <p className="text-text-muted text-[10px] flex items-center gap-1">
                {p.role === 'primary' ? 'Полный доступ' : 'Только свои траты'}
                {p.pinHash && <Lock size={9} />}
              </p>
            </button>
          ))}
        </div>

        {profiles.length === 0 && (
          <p className="text-text-muted text-sm text-center">Профили загружаются…</p>
        )}
      </div>
    </div>
  )
}
