import { v4 as uuid } from 'uuid'
import { db, PRIMARY_PROFILE_ID } from './index'
import { enqueue } from './queue'
import type { Profile, ProfileRole } from '../types'

/**
 * Подпрофили внутри одного аккаунта: «семейный кабинет».
 *
 * ЧЕСТНАЯ ГРАНИЦА ОТВЕТСТВЕННОСТИ:
 * роль разделяет ИНТЕРФЕЙС, а не данные. Все подпрофили ходят под одним
 * Supabase-пользователем, значит у них один JWT и одни и те же права в базе.
 * Человек, у которого есть доступ к устройству, технически может достать все
 * строки. Это защита от «случайно увидел», а не от целенаправленного взгляда.
 * Настоящее разграничение требует отдельных логинов и household-модели в RLS.
 */

export const PROFILE_COLORS = [
  '#6C63FF', '#00C896', '#FF8C42', '#E91E63', '#03A9F4', '#9C27B0', '#8BC34A', '#FF5C7A',
]

export const PROFILE_EMOJI = ['👤', '🦊', '🐻', '🐱', '🐶', '🦉', '🐼', '🦁', '🌿', '⚡']

const ACTIVE_KEY = 'finflow.activeProfile'

export function getActiveProfileId(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY) } catch { return null }
}

export function setActiveProfileId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch { /* приватный режим — переживём */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Пин-код
// ─────────────────────────────────────────────────────────────────────────────

/** SHA-256 в hex. Сам пин нигде не хранится — ни в базе, ни в localStorage. */
export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`finflow:${pin}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function checkPin(profile: Profile, pin: string): Promise<boolean> {
  if (!profile.pinHash) return true
  return (await hashPin(pin)) === profile.pinHash
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function listProfiles(includeArchived = false): Promise<Profile[]> {
  const all = await db.profiles.orderBy('sortOrder').toArray()
  return includeArchived ? all : all.filter(p => !p.isArchived)
}

/**
 * Гарантирует, что основной профиль существует. Нужен для двух случаев:
 * свежая установка (миграция v3→v4 не запускалась) и аккаунт, где профили
 * ещё не приехали из облака.
 */
export async function ensureDefaultProfile(userName?: string): Promise<Profile> {
  const existing = await db.profiles.get(PRIMARY_PROFILE_ID)
  if (existing) return existing

  const anyPrimary = (await db.profiles.toArray()).find(p => p.role === 'primary' && !p.isArchived)
  if (anyPrimary) return anyPrimary

  const now = new Date().toISOString()
  const profile: Profile = {
    id: PRIMARY_PROFILE_ID,
    name: userName?.trim() || 'Основной',
    emoji: '👤',
    color: PROFILE_COLORS[0],
    role: 'primary',
    pinHash: null,
    isArchived: 0,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  await db.profiles.put(profile)
  await enqueue('profile', profile.id, 'upsert', profile)
  return profile
}

export interface ProfileInput {
  name: string
  emoji?: string
  color?: string
  role: ProfileRole
  pin?: string | null
}

export async function createProfile(i: ProfileInput): Promise<Profile> {
  const now = new Date().toISOString()
  const count = await db.profiles.count()
  const profile: Profile = {
    id: uuid(),
    name: i.name.trim() || 'Без имени',
    emoji: i.emoji || PROFILE_EMOJI[count % PROFILE_EMOJI.length],
    color: i.color || PROFILE_COLORS[count % PROFILE_COLORS.length],
    role: i.role,
    pinHash: i.pin ? await hashPin(i.pin) : null,
    isArchived: 0,
    sortOrder: count,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  await db.profiles.put(profile)
  await enqueue('profile', profile.id, 'upsert', profile)
  return profile
}

export async function updateProfile(id: string, patch: Partial<Profile>): Promise<void> {
  await db.profiles.update(id, { ...patch, updatedAt: new Date().toISOString() })
  const fresh = await db.profiles.get(id)
  if (fresh) await enqueue('profile', id, 'upsert', fresh)
}

export async function renameProfile(id: string, name: string): Promise<void> {
  await updateProfile(id, { name: name.trim() || 'Без имени' })
}

export async function setProfilePin(id: string, pin: string | null): Promise<void> {
  await updateProfile(id, { pinHash: pin ? await hashPin(pin) : null })
}

/**
 * Профиль удаляется только если на нём нет операций — иначе они осиротеют
 * и пропадут из всех разрезов. В остальных случаях архивируем.
 */
export async function removeProfile(id: string): Promise<'deleted' | 'archived' | 'blocked'> {
  const profile = await db.profiles.get(id)
  if (!profile) return 'blocked'

  if (profile.role === 'primary') {
    const otherPrimary = (await db.profiles.toArray())
      .filter(p => p.role === 'primary' && !p.isArchived && p.id !== id)
    if (!otherPrimary.length) return 'blocked'   // последний главный профиль не трогаем
  }

  const used = await db.transactions.where('profileId').equals(id).count()
  if (used > 0) {
    await updateProfile(id, { isArchived: 1 })
    return 'archived'
  }
  await db.profiles.delete(id)
  await enqueue('profile', id, 'delete', null)
  if (getActiveProfileId() === id) setActiveProfileId(null)
  return 'deleted'
}

/** Последний главный профиль понижать нельзя — кабинет останется без хозяина. */
export async function isLastPrimary(id: string): Promise<boolean> {
  const live = (await db.profiles.toArray()).filter(p => !p.isArchived && p.role === 'primary')
  return live.length <= 1 && live[0]?.id === id
}

export async function setProfileRole(id: string, role: ProfileRole): Promise<'ok' | 'blocked'> {
  if (role === 'member' && await isLastPrimary(id)) return 'blocked'
  await updateProfile(id, { role })
  return 'ok'
}

/**
 * Матрица прав. Единственный источник правды и для интерфейса, и для текста
 * в настройках: если право меняется — правится здесь, а не в трёх экранах.
 */
export const ROLE_RIGHTS: Record<ProfileRole, { label: string; hint: string; can: string[]; cannot: string[] }> = {
  primary: {
    label: 'Полный доступ',
    hint: 'Хозяин кабинета',
    can: [
      'Видит общий баланс и все счета',
      'Видит операции всех профилей',
      'Аналитика по всему кабинету и в разрезе профилей',
      'Создаёт счета, цели, бюджеты',
      'Управляет профилями и их ролями',
      'Выгружает данные и бэкапы',
    ],
    cannot: [],
  },
  member: {
    label: 'Только свои траты',
    hint: 'Домашний пользователь',
    can: [
      'Добавляет операции на любой общий счёт',
      'Видит и правит свои операции',
      'Аналитика по своим тратам',
    ],
    cannot: [
      'Не видит общий баланс и остатки по счетам',
      'Не видит чужие операции',
      'Не видит цели и накопления',
      'Не управляет профилями',
    ],
  },
}

export function profileName(profiles: Profile[], id?: string | null): string {
  if (!id) return 'Без профиля'
  return profiles.find(p => p.id === id)?.name ?? 'Удалённый профиль'
}

/** Видит ли профиль чужие траты и общий баланс. */
export function canSeeEverything(profile: Profile | null): boolean {
  return profile?.role === 'primary'
}
