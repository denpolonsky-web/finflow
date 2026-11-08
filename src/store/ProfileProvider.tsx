import React, { useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { getActiveProfileId, setActiveProfileId } from '../db/profiles'
import { ProfileCtx } from './ProfileContext'
import { loadViewScope, saveViewScope, type ViewScope } from '../utils/uiPrefs'
import type { Transaction } from '../types'

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(() => getActiveProfileId())
  const [viewScope, setScopeState] = useState<ViewScope>(loadViewScope)

  const profiles = useLiveQuery(
    () => db.profiles.orderBy('sortOrder').toArray().then(l => l.filter(p => !p.isArchived)),
    [],
  )

  /**
   * Активный профиль ВЫЧИСЛЯЕТСЯ, а не выставляется эффектом. Если профиль
   * один и он без пин-кода, выбирать не из чего — входим в него сразу,
   * без лишнего рендера и без экрана выбора.
   */
  const profile = useMemo(() => {
    if (!profiles) return null
    const picked = profiles.find(p => p.id === activeId)
    if (picked) return picked
    if (!activeId && profiles.length === 1 && !profiles[0].pinHash) return profiles[0]
    return null
  }, [profiles, activeId])

  const selectProfile = useCallback((id: string) => {
    setActiveProfileId(id)
    setActiveId(id)
  }, [])

  const leaveProfile = useCallback(() => {
    setActiveProfileId(null)
    setActiveId(null)
  }, [])

  const canSeeAll = profile?.role === 'primary'

  const setViewScope = useCallback((v: ViewScope) => {
    setScopeState(v)
    saveViewScope(v)
  }, [])

  /**
   * Главная роль видит всё и может сузить разрез до своих трат или до
   * конкретного профиля — это и есть «стакать вместе или смотреть раздельно».
   * Вторая роль видит только свои операции, и разрез на это не влияет:
   * ограничение по роли применяется первым и настройкой не обходится.
   *
   * Операции без profileId (достались от миграции) считаются общими и
   * показываются только главной роли, иначе второй профиль увидел бы
   * всю прошлую историю кабинета.
   */
  const scope = useCallback(
    <T extends Pick<Transaction, 'profileId'>>(txs: T[]): T[] => {
      if (!canSeeAll) return txs.filter(t => t.profileId === profile?.id)
      if (viewScope === 'all') return txs
      if (viewScope === 'mine') return txs.filter(t => t.profileId === profile?.id)
      return txs.filter(t => t.profileId === viewScope)
    },
    [canSeeAll, profile?.id, viewScope],
  )

  const canSwitchScope = canSeeAll && (profiles?.length ?? 0) > 1

  const value = useMemo(
    () => ({
      profiles: profiles ?? [],
      profile,
      canSeeAll,
      selectProfile,
      leaveProfile,
      scope,
      viewScope,
      setViewScope,
      canSwitchScope,
      loading: profiles === undefined,
    }),
    [profiles, profile, canSeeAll, selectProfile, leaveProfile, scope, viewScope, setViewScope, canSwitchScope],
  )

  return <ProfileCtx.Provider value={value}>{children}</ProfileCtx.Provider>
}
