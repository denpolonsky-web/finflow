import { createContext, useContext } from 'react'
import type { ViewScope } from '../utils/uiPrefs'
import type { Profile, Transaction } from '../types'

/**
 * Контекст и хук держим отдельно от провайдера: файл, который экспортирует
 * и компонент, и функции, ломает fast refresh (и ругается eslint).
 * Провайдер живёт в `ProfileProvider.tsx`, импорт `useProfile` отсюда не менялся.
 */
export interface ProfileState {
  /** все живые подпрофили */
  profiles: Profile[]
  /** активный подпрофиль; null — ещё не выбран */
  profile: Profile | null
  /** true — главная роль: видит все счета, все траты, всю статистику */
  canSeeAll: boolean
  selectProfile: (id: string) => void
  leaveProfile: () => void
  /**
   * Оставляет только те операции, которые активный профиль вправе видеть,
   * с учётом выбранного разреза. Фильтр по роли применяется ПЕРВЫМ и не
   * зависит от разреза — иначе его можно было бы обойти настройкой.
   */
  scope: <T extends Pick<Transaction, 'profileId'>>(txs: T[]) => T[]
  /** чьи операции показывать: весь кабинет, только свои или конкретный профиль */
  viewScope: ViewScope
  setViewScope: (v: ViewScope) => void
  /** можно ли вообще переключать разрез (только у главной роли и если профилей больше одного) */
  canSwitchScope: boolean
  loading: boolean
}

export const ProfileCtx = createContext<ProfileState | null>(null)

export function useProfile(): ProfileState {
  const ctx = useContext(ProfileCtx)
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider')
  return ctx
}
