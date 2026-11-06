import { createContext, useContext } from 'react'
import type { TabId, Transaction } from '../types'

/**
 * Контекст и хук держим отдельно от провайдера: файл, который экспортирует
 * и компонент, и функции, ломает fast refresh (и ругается eslint).
 * Провайдер живёт в `AppProvider.tsx`, импорт `useApp` отсюда не менялся.
 */
export interface AppState {
  activeTab: TabId
  setActiveTab: (t: TabId) => void
  isAddOpen: boolean
  openAdd: () => void
  closeAdd: () => void
  editTx: Transaction | null
  setEditTx: (t: Transaction | null) => void
  toast: string | null
  showToast: (msg: string) => void
}

export const AppCtx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
