import { useEffect, useState } from 'react'
import { AppProvider, useApp } from './store/AppContext'
import { BottomNav } from './components/layout/BottomNav'
import { HomeScreen } from './components/screens/HomeScreen'
import { TransactionsScreen } from './components/screens/TransactionsScreen'
import { StatsScreen } from './components/screens/StatsScreen'
import { GoalsScreen } from './components/screens/GoalsScreen'
import { CardsScreen } from './components/screens/CardsScreen'
import { AddTransactionSheet } from './components/screens/AddTransactionSheet'
import { OnboardingScreen } from './components/screens/OnboardingScreen'
import { isFirstLaunch } from './db'
import { useOfflineSync } from './hooks/useOfflineSync'
import { registerDevice } from './db/deviceToken'
import { pullFromSupabase } from './db/syncDown'
import { hasSupabase } from './db/supabase'

function SyncBanner() {
  const { status, pendingCount, attemptSync, hasSupabase } = useOfflineSync()
  if (status === 'online') return null

  const cfg = {
    offline: { bg: 'bg-bg-card2 border-b border-border',             text: 'text-text-secondary', label: '📵 Офлайн — данные сохраняются локально' },
    syncing: { bg: 'bg-accent/10 border-b border-accent/20',         text: 'text-accent',         label: '🔄 Синхронизация...' },
    pending: { bg: 'bg-yellow-500/10 border-b border-yellow-500/20', text: 'text-yellow-400',     label: `☁️ Ожидает синхронизации: ${pendingCount}` },
  } as const
  const c = cfg[status as keyof typeof cfg] ?? cfg.offline

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 ${c.bg} py-2 px-4 flex items-center justify-between`}>
      <p className={`text-xs font-medium ${c.text}`}>{c.label}</p>
      {status === 'pending' && (
        <button onClick={attemptSync} className="text-xs text-accent underline">
          {hasSupabase ? 'Синхр.' : 'Нет сервера'}
        </button>
      )}
    </div>
  )
}

function AppInner() {
  const { activeTab } = useApp()
  const [loading,   setLoading]   = useState(true)
  const [onboarded, setOnboarded] = useState(true)

  useEffect(() => {
    async function init() {
      // Always pull from Supabase first if online — regardless of onboarding state
      if (hasSupabase && navigator.onLine) {
        console.log('[App] pulling from Supabase...')
        await pullFromSupabase()
        console.log('[App] pull done')
      }

      // Check if settings exist locally (after pull they might)
      const first = await isFirstLaunch()
      setOnboarded(!first)
      registerDevice()
      setLoading(false)
    }
    init()
  }, [])

  if (loading) return (
    <div className="min-h-dvh bg-bg-primary flex flex-col items-center justify-center gap-3">
      <div className="text-5xl animate-pulse">💰</div>
      <p className="text-text-muted text-sm">
        {hasSupabase && navigator.onLine ? 'Загрузка данных...' : 'Запуск...'}
      </p>
    </div>
  )

  if (!onboarded) return (
    <OnboardingScreen onDone={() => setOnboarded(true)} />
  )

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <SyncBanner />
      <div className="max-w-lg mx-auto px-4 pt-12">
        {activeTab === 'home'         && <HomeScreen />}
        {activeTab === 'transactions' && <TransactionsScreen />}
        {activeTab === 'stats'        && <StatsScreen />}
        {activeTab === 'goals'        && <GoalsScreen />}
        {activeTab === 'cards'        && <CardsScreen />}
      </div>
      <BottomNav />
      <AddTransactionSheet />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  )
}
