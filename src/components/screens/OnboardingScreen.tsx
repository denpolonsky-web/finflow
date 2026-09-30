import { seedDefaultUser } from '../../db'
import { pullFromSupabase } from '../../db/syncDown'
import { hasSupabase } from '../../db/supabase'
import { registerDevice } from '../../db/deviceToken'

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  async function start() {
    if (hasSupabase && navigator.onLine) {
      await pullFromSupabase()
      const { db } = await import('../../db')
      const settings = await db.settings.get(1)
      if (!settings) await seedDefaultUser()
    } else {
      await seedDefaultUser()
    }
    await registerDevice()
    onDone()
  }

  return (
    <div className="min-h-dvh bg-bg-primary flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="text-center">
          <div className="text-7xl mb-6">💰</div>
          <h1 className="text-text-primary text-3xl font-bold">FinFlow</h1>
          <p className="text-text-secondary text-base mt-3 leading-relaxed">
            Личный контроль финансов.<br />Работает офлайн, синхронизируется везде.
          </p>
        </div>
        <div className="w-full flex flex-col gap-3">
          <button
            onClick={start}
            className="w-full bg-accent text-white font-bold rounded-2xl py-4 text-base active:scale-[.98] transition-transform"
          >
            Начать →
          </button>
        </div>
      </div>
    </div>
  )
}
