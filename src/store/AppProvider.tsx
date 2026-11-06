import React, { useState, useCallback, useMemo } from 'react'
import { AppCtx } from './AppContext'
import type { TabId, Transaction } from '../types'

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
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
