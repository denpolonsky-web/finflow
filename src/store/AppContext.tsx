import React, { createContext, useContext, useState, useCallback } from 'react'
import type { TabId } from '../types'

interface AppState {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  isAddSheetOpen: boolean
  openAddSheet: () => void
  closeAddSheet: () => void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [isAddSheetOpen, setAddSheetOpen] = useState(false)

  const openAddSheet = useCallback(() => setAddSheetOpen(true), [])
  const closeAddSheet = useCallback(() => setAddSheetOpen(false), [])

  return (
    <AppContext.Provider value={{ activeTab, setActiveTab, isAddSheetOpen, openAddSheet, closeAddSheet }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
