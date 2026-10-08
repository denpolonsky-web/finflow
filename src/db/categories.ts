import type { Category } from '../types'

/**
 * `essential: true` — обязательная трата. Делит расходы на то, что нельзя
 * отключить, и дискреционное; на этом строится половина аналитики.
 * TRANSFER_CATEGORY_ID — служебная категория для переводов между своими счетами:
 * без неё «Перевод» падал с TypeError, потому что подходящих категорий не было вовсе.
 */
export const TRANSFER_CATEGORY_ID = 'transfer'
export const ADJUST_EXPENSE_ID = 'adjust_exp'
export const ADJUST_INCOME_ID = 'adjust_inc'

export const DEFAULT_CATEGORIES: Category[] = [
  // расходы
  { id: 'groceries',     name: 'Продукты',     icon: '🛒', color: '#4CAF50', type: 'expense', essential: true },
  { id: 'food',          name: 'Кафе и еда',   icon: '🍔', color: '#FF8C42', type: 'expense' },
  { id: 'transport',     name: 'Транспорт',    icon: '🚇', color: '#2196F3', type: 'expense', essential: true },
  { id: 'housing',       name: 'ЖКХ и аренда', icon: '🏠', color: '#795548', type: 'expense', essential: true },
  { id: 'telecom',       name: 'Связь',        icon: '📱', color: '#00BCD4', type: 'expense', essential: true },
  { id: 'health',        name: 'Здоровье',     icon: '💊', color: '#E91E63', type: 'expense', essential: true },
  { id: 'entertainment', name: 'Развлечения',  icon: '🎮', color: '#9C27B0', type: 'expense' },
  { id: 'clothes',       name: 'Одежда',       icon: '👔', color: '#FF5722', type: 'expense' },
  { id: 'shopping',      name: 'Покупки',      icon: '📦', color: '#FF9800', type: 'expense' },
  { id: 'sport',         name: 'Спорт',        icon: '💪', color: '#8BC34A', type: 'expense' },
  { id: 'travel',        name: 'Путешествия',  icon: '✈️', color: '#03A9F4', type: 'expense' },
  { id: 'education',     name: 'Образование',  icon: '🎓', color: '#673AB7', type: 'expense' },
  { id: 'pets',          name: 'Животные',     icon: '🐾', color: '#A1887F', type: 'expense' },
  { id: 'subscriptions', name: 'Подписки',     icon: '🔁', color: '#5C6BC0', type: 'expense', essential: true },
  { id: 'other_exp',     name: 'Другое',       icon: '💸', color: '#607D8B', type: 'expense' },
  { id: ADJUST_EXPENSE_ID, name: 'Корректировка', icon: '⚖️', color: '#455A64', type: 'expense' },
  // доходы
  { id: 'salary',        name: 'Зарплата',     icon: '💰', color: '#00C896', type: 'income' },
  { id: 'freelance',     name: 'Фриланс',      icon: '💻', color: '#00BFA5', type: 'income' },
  { id: 'interest',      name: 'Проценты',     icon: '🏦', color: '#26C6DA', type: 'income' },
  { id: 'gift',          name: 'Подарок',      icon: '🎁', color: '#F06292', type: 'income' },
  { id: 'other_inc',     name: 'Другое',       icon: '📈', color: '#26A69A', type: 'income' },
  { id: ADJUST_INCOME_ID, name: 'Корректировка', icon: '⚖️', color: '#455A64', type: 'income' },
  // служебная
  { id: TRANSFER_CATEGORY_ID, name: 'Перевод', icon: '🔄', color: '#6C63FF', type: 'both' },
]

const BY_ID = new Map(DEFAULT_CATEGORIES.map(c => [c.id, c]))

export function getCategory(id: string): Category | undefined {
  return BY_ID.get(id)
}

export function categoryIcon(id: string): string {
  return BY_ID.get(id)?.icon ?? '💳'
}

export function categoryName(id: string): string {
  return BY_ID.get(id)?.name ?? 'Без категории'
}

export function categoryColor(id: string): string {
  return BY_ID.get(id)?.color ?? '#607D8B'
}

/** Категории, доступные пользователю при выборе (без служебных). */
export function selectableCategories(type: 'expense' | 'income'): Category[] {
  return DEFAULT_CATEGORIES.filter(
    c => (c.type === type || c.type === 'both') && c.id !== TRANSFER_CATEGORY_ID,
  )
}
