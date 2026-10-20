import React, { createContext, useContext, useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { getActiveProfileId, setActiveProfileId } from '../db/profiles'
import type { Profile, Transaction } from '../types'

interface ProfileState {
  /** все живые подпрофили */
  profiles: Profile[]
  /** активный подпрофиль; null — ещё не выбран */
  profile: Profile | null
  /** true — главная роль: видит все счета, все траты, всю статистику */
  canSeeAll: boolean
  selectProfile: (id: string) => void
  leaveProfile: () => void
  /** оставляет только те операции, которые активный профиль вправе видеть */
  scope: <T extends Pick<Transaction, 'profileId'>>(txs: T[]) => T[]
  loading: boolean
}

const Ctx = createContext<ProfileState | null>(null)

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(() => getActiveProfileId())

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

  /**
   * Главная роль видит всё. Вторая — только свои операции.
   * Операции без profileId (достались от миграции) считаются общими и
   * показываются только главной роли, иначе второй профиль увидел бы
   * всю прошлую историю кабинета.
   */
  const scope = useCallback(
    <T extends Pick<Transaction, 'profileId'>>(txs: T[]): T[] =>
      canSeeAll ? txs : txs.filter(t => t.profileId === profile?.id),
    [canSeeAll, profile?.id],
  )

  const value = useMemo(
    () => ({
      profiles: profiles ?? [],
      profile,
      canSeeAll,
      selectProfile,
      leaveProfile,
      scope,
      loading: profiles === undefined,
    }),
    [profiles, profile, canSeeAll, selectProfile, leaveProfile, scope],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useProfile(): ProfileState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider')
  return ctx
}
