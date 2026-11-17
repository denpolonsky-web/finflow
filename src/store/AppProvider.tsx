import React, { useState, useCallback, useMemo } from 'react'
import { AppCtx, type Toast, type ToastAction } from './AppContext'
import type { TabId, Transaction } from '../types'

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [isAddOpen, setAddOpen] = useState(false)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const openAdd = useCallback(() => setAddOpen(true), [])
  const closeAdd = useCallback(() => setAddOpen(false), [])
  const showToast = useCallback((msg: string, action?: ToastAction) => {
    const next: Toast = { msg, action }
    setToast(next)
    // сравниваем по ссылке: более свежее уведомление своим таймером не гасим
    setTimeout(() => setToast(t => (t === next ? null : t)), action ? 6000 : 2600)
  }, [])
  const hideToast = useCallback(() => setToast(null), [])

  const value = useMemo(
    () => ({ activeTab, setActiveTab, isAddOpen, openAdd, closeAdd, editTx, setEditTx, toast, showToast, hideToast }),
    [activeTab, isAddOpen, openAdd, closeAdd, editTx, toast, showToast, hideToast],
  )
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
