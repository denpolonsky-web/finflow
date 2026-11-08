import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { db, DEFAULT_SETTINGS } from '../../db'
import { createAccount, BANK_PRESETS, ACCOUNT_KINDS } from '../../db/accounts'
import { enqueue } from '../../db/queue'
import { toMinor } from '../../utils/money'
import { inputCls, primaryBtn } from '../ui/Sheet'
import { MoneyInput } from '../ui/MoneyInput'
import type { AccountKind } from '../../types'

/**
 * Прошлая версия падала молча: start() не имел ни try/catch, ни таймаута,
 * ни индикатора — зависший запрос к Supabase навсегда подвешивал await,
 * и кнопка выглядела мёртвой. Здесь каждый шаг локальный, а всё сетевое
 * вынесено из критического пути.
 */
export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<0 | 1>(0)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('debit')
  const [bank, setBank] = useState('other')
  const [accName, setAccName] = useState('')
  const [balance, setBalance] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function finish(withAccount: boolean) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const now = new Date().toISOString()
      const settings = { ...DEFAULT_SETTINGS, userName: name.trim() || 'друг', updatedAt: now }
      await db.settings.put(settings)
      await enqueue('settings', 'settings', 'upsert', settings)

      if (withAccount && accName.trim()) {
        await createAccount({
          kind, bank,
          name: accName.trim(),
          openingBalance: toMinor(balance || '0'),
        })
      }
      onDone()
    } catch (e) {
      console.error('[onboarding]', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-bg-primary flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm flex flex-col gap-7">
        {step === 0 ? (
          <>
            <div className="text-center">
              <div className="text-6xl mb-4">💰</div>
              <h1 className="text-text-primary text-3xl font-bold">FinFlow</h1>
              <p className="text-text-secondary text-sm mt-2 leading-relaxed">
                Личный контроль финансов.<br />Работает офлайн, синхронизируется между устройствами.
              </p>
            </div>
            <input
              placeholder="Как к вам обращаться?" value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setStep(1) }}
              className={inputCls} autoFocus
            />
            <button onClick={() => setStep(1)} className={primaryBtn}>Начать →</button>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-text-primary text-2xl font-bold">Первый счёт</h1>
              <p className="text-text-secondary text-sm mt-1">
                Укажите остаток — от него будет считаться баланс. Позже можно добавить ещё.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <p className="text-text-muted text-xs mb-2">Тип</p>
                <div className="grid grid-cols-3 gap-2">
                  {ACCOUNT_KINDS.map(k => (
                    <button key={k.id} onClick={() => setKind(k.id)}
                      className={`py-2.5 rounded-xl text-xs font-semibold transition-all ${
                        kind === k.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                      {k.icon} {k.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-text-muted text-xs mb-2">Банк</p>
                <div className="grid grid-cols-3 gap-2">
                  {BANK_PRESETS.map(p => (
                    <button key={p.id}
                      onClick={() => { setBank(p.id); setAccName(n => n || p.name) }}
                      className={`py-2.5 rounded-xl text-xs font-semibold transition-all ${
                        bank === p.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <input placeholder="Название счёта" value={accName}
                onChange={e => setAccName(e.target.value)} className={inputCls} />
              <MoneyInput placeholder="Текущий остаток, ₽" value={balance}
                onChange={setBalance} className={inputCls} />
            </div>

            {error && <p className="text-accent-red text-xs">{error}</p>}

            <div className="flex flex-col gap-2">
              <button onClick={() => finish(true)} disabled={busy || !accName.trim()}
                className={`${primaryBtn} flex items-center justify-center gap-2`}>
                {busy && <Loader2 size={16} className="animate-spin" />} Готово
              </button>
              <button onClick={() => finish(false)} disabled={busy}
                className="text-text-muted text-xs py-2">
                Пропустить — добавлю позже
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
