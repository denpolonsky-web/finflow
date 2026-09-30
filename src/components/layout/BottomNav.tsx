import { Home, List, BarChart2, Plus, CreditCard } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import type { TabId } from '../../types'

const TABS: { id: TabId; icon: React.FC<{ size: number; strokeWidth: number }>; label: string }[] = [
  { id: 'home',         icon: Home,       label: 'Главная' },
  { id: 'transactions', icon: List,       label: 'Операции' },
  { id: 'add',          icon: Plus,       label: '' },
  { id: 'stats',        icon: BarChart2,  label: 'Статистика' },
  { id: 'cards',        icon: CreditCard, label: 'Карты' },
]

export function BottomNav() {
  const { activeTab, setActiveTab, openAddSheet } = useApp()

  function handleTab(id: TabId) {
    if (id === 'add') { openAddSheet(); return }
    setActiveTab(id)
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-bg-card/95 backdrop-blur-md border-t border-border pb-safe">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {TABS.map(({ id, icon: Icon, label }) =>
          id === 'add' ? (
            <button
              key="add"
              onClick={() => handleTab('add')}
              className="flex items-center justify-center w-14 h-14 rounded-full bg-accent shadow-lg shadow-accent/30 -mt-5 transition-transform active:scale-95"
              aria-label="Добавить транзакцию"
            >
              <Icon size={26} strokeWidth={2.5} />
            </button>
          ) : (
            <button
              key={id}
              onClick={() => handleTab(id)}
              className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-colors ${
                activeTab === id ? 'text-accent' : 'text-text-secondary'
              }`}
            >
              <Icon size={22} strokeWidth={activeTab === id ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          )
        )}
      </div>
    </nav>
  )
}
