import { useCallback, useEffect, useState } from 'react'
import { CloudOff, RefreshCw, AlertTriangle } from 'lucide-react'
import { AppProvider, useApp } from './store/AppContext'
import { ProfileProvider, useProfile } from './store/ProfileContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BottomNav } from './components/layout/BottomNav'
import { HomeScreen } from './components/screens/HomeScreen'
import { TransactionsScreen } from './components/screens/TransactionsScreen'
import { StatsScreen } from './components/screens/StatsScreen'
import { GoalsScreen } from './components/screens/GoalsScreen'
import { AccountsScreen } from './components/screens/AccountsScreen'
import { SettingsScreen } from './components/screens/SettingsScreen'
import { TransactionSheet } from './components/screens/TransactionSheet'
import { OnboardingScreen } from './components/screens/OnboardingScreen'
import { AuthScreen } from './components/screens/AuthScreen'
import { ProfileGate } from './components/screens/ProfileGate'
import { isFirstLaunch, getSettings } from './db'
import { ensureDefaultProfile } from './db/profiles'
import { hasSupabase, withTimeout } from './db/supabase'
import { getSession, onAuthChange, onUserResolved } from './db/auth'
import { bootstrapSync } from './db/sync'
import { useSync } from './hooks/useSync'

const LOCAL_ONLY_KEY = 'finflow.localOnly'

type Phase = 'booting' | 'auth' | 'onboarding' | 'ready'

function Splash({ text }: { text: string }) {
  return (
    <div className="min-h-dvh bg-bg-primary flex flex-col items-center justify-center gap-3">
      <div className="text-5xl animate-pulse">💰</div>
      <p className="text-text-muted text-sm">{text}</p>
    </div>
  )
}

function SyncBanner({ status, pending, onRetry }: {
  status: ReturnType<typeof useSync>['status']; pending: number; onRetry: () => void
}) {
  if (status === 'online' || status === 'local') return null
  const cfg = {
    offline: { cls: 'bg-bg-card2 border-border text-text-secondary', icon: <CloudOff size={13} />, label: 'Офлайн — данные сохраняются локально' },
    syncing: { cls: 'bg-accent/10 border-accent/20 text-accent', icon: <RefreshCw size={13} className="animate-spin" />, label: 'Синхронизация…' },
    pending: { cls: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400', icon: <RefreshCw size={13} />, label: `Ожидает отправки: ${pending}` },
    error:   { cls: 'bg-red-500/10 border-red-500/20 text-accent-red', icon: <AlertTriangle size={13} />, label: 'Ошибка синхронизации' },
  } as const
  const c = cfg[status as keyof typeof cfg]
  if (!c) return null
  return (
    <div className={`fixed top-0 left-0 right-0 z-50 border-b py-2 px-4 flex items-center justify-between ${c.cls}`}
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0.5rem)' }}>
      <p className="text-xs font-medium flex items-center gap-1.5">{c.icon} {c.label}</p>
      {(status === 'pending' || status === 'error') && (
        <button onClick={onRetry} className="text-xs underline">Повторить</button>
      )}
    </div>
  )
}

function Toast() {
  const { toast } = useApp()
  if (!toast) return null
  return (
    <div className="fixed left-0 right-0 z-[60] flex justify-center px-4 pointer-events-none"
      style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}>
      <div className="bg-bg-card2 border border-border text-text-primary text-sm px-4 py-2.5 rounded-xl shadow-lg">
        {toast}
      </div>
    </div>
  )
}

function AppInner() {
  const { activeTab, isAddOpen, closeAdd, editTx, setEditTx } = useApp()
  const { profile, profiles, loading: profilesLoading, leaveProfile } = useProfile()
  const [phase, setPhase] = useState<Phase>('booting')
  const [splashText, setSplashText] = useState('Запуск…')
  const [authed, setAuthed] = useState(false)
  const [localOnly, setLocalOnly] = useState(() => localStorage.getItem(LOCAL_ONLY_KEY) === '1')

  const sync = useSync(authed)

  /**
   * Критично: каждый шаг инициализации обёрнут в try/catch и таймаут.
   * В прошлой версии незавершившийся запрос к Supabase оставлял приложение
   * на сплэше навсегда, а аналогичный await в онбординге делал кнопку мёртвой.
   */
  const boot = useCallback(async () => {
    try {
      let signedIn = false
      if (hasSupabase && !localOnly) {
        setSplashText('Проверяем вход…')
        const session = await getSession()
        signedIn = Boolean(session)
        if (session) await onUserResolved(session.user)
        if (!signedIn) { setPhase('auth'); return }
      }
      setAuthed(signedIn)

      if (signedIn && navigator.onLine) {
        setSplashText('Загружаем данные…')
        // даже если облако не ответит — идём дальше и работаем локально
        await withTimeout(bootstrapSync(), 15_000, 'bootstrapSync')
      }

      // основной подпрофиль должен существовать всегда: и на свежей установке,
      // и на аккаунте, куда профили ещё не приехали из облака
      if (!(await isFirstLaunch())) {
        await ensureDefaultProfile((await getSettings())?.userName)
      }

      setPhase((await isFirstLaunch()) ? 'onboarding' : 'ready')
    } catch (e) {
      console.error('[boot]', e)
      // приложение всё равно должно открыться: данные лежат локально
      try {
        setPhase((await isFirstLaunch()) ? 'onboarding' : 'ready')
      } catch {
        setPhase('ready')
      }
    }
  }, [localOnly])

  useEffect(() => { void boot() }, [boot])

  useEffect(() => onAuthChange(session => {
    if (!session && hasSupabase && !localOnly) { setAuthed(false); setPhase('auth') }
  }), [localOnly])

  // Страховка: кабинет без единого профиля — создаём основной.
  // Выбор «кто пользуется» живёт в ProfileContext и считается при рендере.
  useEffect(() => {
    if (phase !== 'ready' || profilesLoading || profiles.length > 0) return
    void ensureDefaultProfile()
  }, [phase, profilesLoading, profiles.length])

  if (phase === 'booting') return <Splash text={splashText} />

  if (phase === 'auth') {
    return (
      <AuthScreen
        onAuthed={() => { setAuthed(true); setPhase('booting'); void boot() }}
        onLocalOnly={() => {
          localStorage.setItem(LOCAL_ONLY_KEY, '1')
          setLocalOnly(true)
          setPhase('booting')
        }}
      />
    )
  }

  if (phase === 'onboarding') {
    return <OnboardingScreen onDone={() => { void ensureDefaultProfile(); setPhase('ready') }} />
  }

  if (profilesLoading) return <Splash text="Загружаем профили…" />
  if (!profile) return <ProfileGate />

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <SyncBanner status={sync.status} pending={sync.pending} onRetry={sync.syncNow} />
      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
        {activeTab === 'home' && <HomeScreen />}
        {activeTab === 'transactions' && <TransactionsScreen />}
        {activeTab === 'stats' && <StatsScreen />}
        {activeTab === 'goals' && <GoalsScreen />}
        {activeTab === 'accounts' && <AccountsScreen />}
        {activeTab === 'settings' && (
          <SettingsScreen
            syncStatus={sync.status}
            pending={sync.pending}
            dead={sync.dead}
            lastError={sync.lastError}
            onSync={sync.syncNow}
            onSwitchProfile={leaveProfile}
            onSignedOut={() => {
              localStorage.removeItem(LOCAL_ONLY_KEY)
              setLocalOnly(false)
              setAuthed(false)
              leaveProfile()
              setPhase('auth')
            }}
          />
        )}
      </div>
      <BottomNav />
      <TransactionSheet open={isAddOpen} tx={null} onClose={closeAdd} />
      <TransactionSheet open={Boolean(editTx)} tx={editTx} onClose={() => setEditTx(null)} />
      <Toast />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <ProfileProvider>
          <AppInner />
        </ProfileProvider>
      </AppProvider>
    </ErrorBoundary>
  )
}
