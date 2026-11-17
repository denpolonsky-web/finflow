import { Home, List, BarChart3, Plus, Wallet, Target, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { useProfile } from '../../store/ProfileContext'
import { usePrefsVersion } from '../../hooks/useUiPrefs'
import { loadNavTabs, NAV_TABS, type NavTabId } from '../../utils/uiPrefs'

const ICONS: Record<NavTabId, LucideIcon> = {
  home: Home,
  transactions: List,
  stats: BarChart3,
  goals: Target,
  accounts: Wallet,
  settings: Settings,
}

const LABELS = new Map(NAV_TABS.map(t => [t.id, t.label]))

export function BottomNav() {
  const { activeTab, setActiveTab, openAdd } = useApp()
  const { canSeeAll } = useProfile()
  // состав панели меняют в настройках, пока она на экране, — подписываемся
  usePrefsVersion()
  const picked = loadNavTabs()
  // вторая роль не видит остатки и накопления — вкладки со счетами и целями прячем
  const visible = canSeeAll ? picked : picked.filter(id => id !== 'accounts' && id !== 'goals')
  const half = Math.ceil(visible.length / 2)
  const left = visible.slice(0, half)
  const right = visible.slice(half)

  /**
   * Панель ужимается под число вкладок: пункты делят ширину поровну
   * (`flex-1 min-w-0`), а с шестой вкладки значки и подписи становятся мельче.
   * Вместе с кнопкой «+» это семь мест на экране шириной 360 — по ~50 пикселей,
   * и «Аналитика» обычным кеглем туда уже не помещается.
   */
  const dense = visible.length > 5

  const item = (id: NavTabId) => {
    const Icon = ICONS[id]
    return (
      <button key={id} onClick={() => setActiveTab(id)}
        aria-current={activeTab === id ? 'page' : undefined}
        className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 rounded-xl transition-colors ${
          activeTab === id ? 'text-accent' : 'text-text-secondary'}`}>
        <Icon size={dense ? 19 : 21} strokeWidth={activeTab === id ? 2.2 : 1.8} />
        <span className={`font-medium max-w-full truncate px-0.5 ${dense ? 'text-[9px]' : 'text-[10px]'}`}>
          {LABELS.get(id)}
        </span>
      </button>
    )
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-bg-card/95 backdrop-blur-md border-t border-border"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0px)' }}>
      <div className="flex items-center h-16 max-w-lg mx-auto px-1">
        {left.map(item)}
        <button onClick={openAdd} aria-label="Добавить операцию"
          className={`flex items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 -mt-5 mx-1 transition-transform active:scale-95 flex-none ${
            dense ? 'w-12 h-12' : 'w-14 h-14'}`}>
          <Plus size={dense ? 23 : 26} strokeWidth={2.5} />
        </button>
        {right.map(item)}
      </div>
    </nav>
  )
}
