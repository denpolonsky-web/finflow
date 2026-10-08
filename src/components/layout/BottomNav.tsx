import { Home, List, BarChart3, Plus, Wallet, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import type { TabId } from '../../types'

const TABS: { id: TabId; icon: LucideIcon; label: string }[] = [
  { id: 'home',         icon: Home,     label: 'Главная' },
  { id: 'transactions', icon: List,     label: 'Операции' },
  { id: 'stats',        icon: BarChart3, label: 'Аналитика' },
  { id: 'goals',        icon: Target,   label: 'Цели' },
  { id: 'accounts',     icon: Wallet,   label: 'Счета' },
]

export function BottomNav() {
  const { activeTab, setActiveTab, openAdd } = useApp()
  const left = TABS.slice(0, 2)
  const right = TABS.slice(2)

  const item = ({ id, icon: Icon, label }: typeof TABS[number]) => (
    <button key={id} onClick={() => setActiveTab(id)}
      aria-current={activeTab === id ? 'page' : undefined}
      className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl transition-colors ${
        activeTab === id ? 'text-accent' : 'text-text-secondary'}`}>
      <Icon size={21} strokeWidth={activeTab === id ? 2.2 : 1.8} />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-bg-card/95 backdrop-blur-md border-t border-border"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0px)' }}>
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        {left.map(item)}
        <button onClick={openAdd} aria-label="Добавить операцию"
          className="flex items-center justify-center w-14 h-14 rounded-full bg-accent text-white shadow-lg shadow-accent/30 -mt-5 transition-transform active:scale-95 flex-none">
          <Plus size={26} strokeWidth={2.5} />
        </button>
        {right.map(item)}
      </div>
    </nav>
  )
}
