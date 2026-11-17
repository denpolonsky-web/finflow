import { useCallback, useEffect, useState } from 'react'
import { CloudOff, RefreshCw, AlertTriangle } from 'lucide-react'
import { useApp } from './store/AppContext'
import { AppProvider } from './store/AppProvider'
import { useProfile } from './store/ProfileContext'
import { ProfileProvider } from './store/ProfileProvider'
import { CategoriesProvider } from './store/CategoriesProvider'
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
import { purgeOldTrash } from './db/transactions'
import { hasSupabase, withTimeout } from './db/supabase'
import { getSession, onAuthChange, onUserResolved } from './db/auth'
import { bootstrapSync } from './db/sync'
import { useSync } from './hooks/useSync'
import type { TabId } from './types'

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

/**
 * Состояние синхронизации — компактной плашкой над нижней навигацией.
 *
 * Раньше это была полоса во всю ширину, прибитая к верху экрана: она занимала
 * шапку целиком и перекрывала заголовок страницы. Статус важен, но он
 * второстепенен — ему хватает плашки. Подробности и кнопки по-прежнему
 * в Настройках → Синхронизация.
 */
function SyncBanner({ status, pending, onRetry }: {
  status: ReturnType<typeof useSync>['status']; pending: number; onRetry: () => void
}) {
  if (status === 'online' || status === 'local') return null
  const cfg = {
    offline: { cls: 'bg-bg-card2/95 border-border text-text-secondary', icon: <CloudOff size={12} />, label: 'Офлайн — сохраняем локально' },
    syncing: { cls: 'bg-bg-card2/95 border-accent/30 text-accent', icon: <RefreshCw size={12} className="animate-spin" />, label: 'Синхронизация…' },
    pending: { cls: 'bg-bg-card2/95 border-yellow-500/30 text-yellow-400', icon: <RefreshCw size={12} />, label: `Ожидает: ${pending}` },
    error:   { cls: 'bg-bg-card2/95 border-red-500/30 text-accent-red', icon: <AlertTriangle size={12} />, label: 'Ошибка синхронизации' },
  } as const
  const c = cfg[status as keyof typeof cfg]
  if (!c) return null
  return (
    /* 5.5rem — выше круглой кнопки «+»: она выступает над навигацией на 5rem,
       и плашка на 4.5rem ложилась ровно на неё. */
    <div className="fixed left-0 right-0 z-40 flex justify-center px-4 pointer-events-none"
      style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}>
      <div className={`pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-lg backdrop-blur-md ${c.cls}`}>
        <span className="text-[11px] font-medium flex items-center gap-1.5">{c.icon} {c.label}</span>
        {(status === 'pending' || status === 'error') && (
          <button onClick={onRetry} className="text-[11px] underline flex-none">Повторить</button>
        )}
      </div>
    </div>
  )
}

function Toast() {
  const { toast, hideToast } = useApp()
  if (!toast) return null
  return (
    /* выше плашки синхронизации: обе висят над навигацией и иначе наложились бы */
    <div className="fixed left-0 right-0 z-[60] flex justify-center px-4 pointer-events-none"
      style={{ bottom: 'calc(8.5rem + env(safe-area-inset-bottom))' }}>
      <div className="pointer-events-auto bg-bg-card2 border border-white/10 text-text-primary text-sm pl-4 pr-2 py-2 rounded-xl shadow-lg flex items-center gap-3">
        <span className="py-0.5 pr-2">{toast.msg}</span>
        {toast.action && (
          <button onClick={() => { toast.action?.run(); hideToast() }}
            className="flex-none bg-accent text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  )
}

/** Вкладки, которые вторая роль видеть не должна: остатки по счетам и накопления. */
const RESTRICTED_TABS: TabId[] = ['accounts', 'goals']

function AppInner() {
  const { activeTab, setActiveTab, isAddOpen, closeAdd, editTx, setEditTx } = useApp()
  const { profile, profiles, canSeeAll, loading: profilesLoading, leaveProfile } = useProfile()
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

      // корзина не копится вечно; запуск от этого не зависит — ошибку только пишем
      void purgeOldTrash().catch(e => console.warn('[trash]', e))

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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- boot асинхронный: setPhase вызывается после await, а не синхронно в теле эффекта
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

  /**
   * Вкладка, оставшаяся от предыдущего профиля, не должна открываться по инерции:
   * primary стоял на «Счетах», сменил профиль на ограниченный — и экран с остатками
   * всех счетов оказывался отрисован, хотя сама вкладка в навигации уже скрыта.
   * Считаем при рендере, а не эффектом: эффект дал бы лишний кадр с чужими данными.
   */
  const tab = !canSeeAll && RESTRICTED_TABS.includes(activeTab) ? 'home' : activeTab

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      {/* `banner`, а не `status`: фоновый круг и только что заведённая операция
          плашку не зажигают — подробный статус остаётся в настройках */}
      <SyncBanner status={sync.banner} pending={sync.pending} onRetry={sync.syncNow} />
      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
        {tab === 'home' && <HomeScreen />}
        {tab === 'transactions' && <TransactionsScreen />}
        {tab === 'stats' && <StatsScreen />}
        {tab === 'goals' && <GoalsScreen />}
        {tab === 'accounts' && <AccountsScreen />}
        {tab === 'settings' && (
          <SettingsScreen
            syncStatus={sync.status}
            pending={sync.pending}
            dead={sync.dead}
            lastError={sync.lastError}
            onSync={sync.syncNow}
            onSwitchProfile={() => { setActiveTab('home'); leaveProfile() }}
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
      {/* Монтируются только когда открыты и взаимно исключают друг друга:
          иначе при одновременно открытых «добавить» и «править» рисовались два
          шита друг поверх друга. `key` по id операции сбрасывает состояние формы
          при переходе с одной операции на другую. */}
      {editTx
        ? <TransactionSheet key={editTx.id} tx={editTx} onClose={() => setEditTx(null)} />
        : isAddOpen && <TransactionSheet key="new" tx={null} onClose={closeAdd} />}
      <Toast />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        {/* справочник категорий выше экранов: от него зависят подписи везде */}
        <CategoriesProvider>
          <ProfileProvider>
            <AppInner />
          </ProfileProvider>
        </CategoriesProvider>
      </AppProvider>
    </ErrorBoundary>
  )
}
