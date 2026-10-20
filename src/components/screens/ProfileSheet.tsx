import { useEffect, useState } from 'react'
import { Check, Loader2, Lock, Trash2, X } from 'lucide-react'
import {
  createProfile, updateProfile, removeProfile, setProfilePin, setProfileRole,
  isLastPrimary, PROFILE_COLORS, PROFILE_EMOJI, ROLE_RIGHTS,
} from '../../db/profiles'
import { useApp } from '../../store/AppContext'
import { Sheet, Field, inputCls, primaryBtn } from '../ui/Sheet'
import type { Profile, ProfileRole } from '../../types'

interface Props {
  /** null — создание нового профиля */
  profile: Profile | null
  onClose: () => void
}

/**
 * Монтируется только когда открыт (с key по профилю), поэтому начальное
 * состояние задаётся прямо в useState — без эффекта, который синхронизировал
 * бы пропсы в стейт и лишний раз перерисовывал форму.
 */
export function ProfileSheet({ profile, onClose }: Props) {
  const { showToast } = useApp()
  const isEdit = Boolean(profile)

  const [name, setName] = useState(profile?.name ?? '')
  const [emoji, setEmoji] = useState(profile?.emoji ?? PROFILE_EMOJI[1])
  const [color, setColor] = useState(profile?.color ?? PROFILE_COLORS[1])
  const [role, setRole] = useState<ProfileRole>(profile?.role ?? 'member')
  const [pin, setPin] = useState('')
  const [clearPin, setClearPin] = useState(false)
  const [lastPrimary, setLastPrimary] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // понижать ли роль — зависит от того, есть ли в кабинете второй «главный»
  useEffect(() => {
    if (!profile) return
    let alive = true
    void isLastPrimary(profile.id).then(v => { if (alive) setLastPrimary(v) })
    return () => { alive = false }
  }, [profile])

  async function save() {
    if (busy || !name.trim()) return
    setBusy(true); setError(null)
    try {
      if (profile) {
        if (role !== profile.role) {
          const r = await setProfileRole(profile.id, role)
          if (r === 'blocked') {
            setError('Это последний профиль с полным доступом — кабинет останется без хозяина')
            return
          }
        }
        await updateProfile(profile.id, { name: name.trim(), emoji, color })
        if (clearPin) await setProfilePin(profile.id, null)
        else if (pin) await setProfilePin(profile.id, pin)
        showToast('Профиль обновлён')
      } else {
        await createProfile({ name, emoji, color, role, pin: pin || null })
        showToast('Профиль создан')
      }
      onClose()
    } catch (e) {
      console.error('[profile save]', e)
      setError('Не удалось сохранить профиль')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!profile || busy) return
    if (!confirm(`Удалить профиль «${profile.name}»? Если на нём есть операции, он будет заархивирован.`)) return
    setBusy(true)
    try {
      const r = await removeProfile(profile.id)
      showToast(
        r === 'deleted' ? 'Профиль удалён'
          : r === 'archived' ? 'Профиль заархивирован — на нём есть операции'
            : 'Нельзя удалить последний профиль с полным доступом',
      )
      if (r !== 'blocked') onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open title={isEdit ? 'Профиль' : 'Новый профиль'}
      subtitle="Права внутри кабинета" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Имя">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="Например, Катя" className={inputCls} />
        </Field>

        <Field label="Значок">
          <div className="flex flex-wrap gap-2">
            {PROFILE_EMOJI.map(e => (
              <button key={e} onClick={() => setEmoji(e)}
                className={`w-10 h-10 rounded-xl text-lg flex items-center justify-center transition-all ${
                  emoji === e ? 'bg-accent' : 'bg-bg-card2'}`}>
                {e}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Цвет">
          <div className="flex flex-wrap gap-2">
            {PROFILE_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} aria-label={`Цвет ${c}`}
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: c }}>
                {color === c && <Check size={15} className="text-white" />}
              </button>
            ))}
          </div>
        </Field>

        {/* ── Роль: главный переключатель прав ─────────────────────── */}
        <Field label="Роль">
          <div className="flex flex-col gap-2">
            {(['primary', 'member'] as ProfileRole[]).map(r => {
              const rights = ROLE_RIGHTS[r]
              const on = role === r
              return (
                <button key={r} onClick={() => { setRole(r); setError(null) }}
                  className={`text-left rounded-2xl p-3 border transition-all ${
                    on ? 'border-accent bg-accent/10' : 'border-border bg-bg-card2'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-text-primary text-sm font-semibold">{rights.label}</p>
                    <span className={`w-4 h-4 rounded-full border-2 flex-none ${
                      on ? 'border-accent bg-accent' : 'border-border'}`} />
                  </div>
                  <p className="text-text-muted text-[10px] mb-2">{rights.hint}</p>
                  <div className="flex flex-col gap-0.5">
                    {rights.can.map(x => (
                      <p key={x} className="text-text-secondary text-[11px] flex items-start gap-1.5">
                        <Check size={11} className="text-accent-green flex-none mt-0.5" /> {x}
                      </p>
                    ))}
                    {rights.cannot.map(x => (
                      <p key={x} className="text-text-muted text-[11px] flex items-start gap-1.5">
                        <X size={11} className="text-accent-red flex-none mt-0.5" /> {x}
                      </p>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
          {isEdit && lastPrimary && (
            <p className="text-text-muted text-[11px] mt-2">
              Это единственный профиль с полным доступом — понизить его нельзя,
              пока не появится второй такой же.
            </p>
          )}
        </Field>

        <Field label={profile?.pinHash ? 'Пин-код (задан)' : 'Пин-код (необязательно)'}>
          <input type="password" inputMode="numeric" value={pin}
            onChange={e => { setPin(e.target.value); setClearPin(false) }}
            placeholder={profile?.pinHash ? 'Оставьте пустым, чтобы не менять' : 'Без пин-кода'}
            className={inputCls} />
          {profile?.pinHash && (
            <button onClick={() => { setClearPin(c => !c); setPin('') }}
              className={`mt-2 text-xs flex items-center gap-1.5 ${
                clearPin ? 'text-accent-red' : 'text-text-muted'}`}>
              <Lock size={12} /> {clearPin ? 'Пин-код будет снят при сохранении' : 'Снять пин-код'}
            </button>
          )}
          <p className="text-text-muted text-[11px] mt-2">
            Пин закрывает вход в профиль на этом устройстве. Он не шифрует данные:
            все профили работают под одним входом в облако.
          </p>
        </Field>

        {error && <p className="text-accent-red text-xs">{error}</p>}

        <button onClick={save} disabled={busy || !name.trim()}
          className={`${primaryBtn} h-13 flex items-center justify-center gap-2`}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          {isEdit ? 'Сохранить' : 'Создать профиль'}
        </button>

        {isEdit && (
          <button onClick={remove} disabled={busy}
            className="w-full h-11 rounded-xl bg-accent-red/10 text-accent-red text-sm font-semibold flex items-center justify-center gap-2">
            <Trash2 size={15} /> Удалить профиль
          </button>
        )}
      </div>
    </Sheet>
  )
}
