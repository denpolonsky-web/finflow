import React, { createContext, useContext, useState, useCallback, useMemo } from 'react'
import type { TabId, Transaction } from '../types'

interface AppState {
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

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [isAddOpen, setAddOpen] = useState(false)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const openAdd = useCallback(() => setAddOpen(true), [])
  const closeAdd = useCallback(() => setAddOpen(false), [])
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(t => (t === msg ? null : t)), 2600)
  }, [])

  const value = useMemo(
    () => ({ activeTab, setActiveTab, isAddOpen, openAdd, closeAdd, editTx, setEditTx, toast, showToast }),
    [activeTab, isAddOpen, openAdd, closeAdd, editTx, toast, showToast],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
