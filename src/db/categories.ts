import type { Category } from '../types'

export const DEFAULT_CATEGORIES: Category[] = [
  // Expenses
  { id: 'food',        name: 'Еда',          icon: '🍔', color: '#FF8C42', type: 'expense' },
  { id: 'groceries',  name: 'Продукты',     icon: '🛒', color: '#4CAF50', type: 'expense' },
  { id: 'transport',  name: 'Транспорт',    icon: '🚇', color: '#2196F3', type: 'expense' },
  { id: 'health',     name: 'Здоровье',     icon: '💊', color: '#E91E63', type: 'expense' },
  { id: 'entertainment', name: 'Развлечения', icon: '🎮', color: '#9C27B0', type: 'expense' },
  { id: 'clothes',    name: 'Одежда',       icon: '👔', color: '#FF5722', type: 'expense' },
  { id: 'telecom',    name: 'Связь',        icon: '📱', color: '#00BCD4', type: 'expense' },
  { id: 'housing',    name: 'ЖКХ',          icon: '🏠', color: '#795548', type: 'expense' },
  { id: 'shopping',   name: 'Покупки',      icon: '📦', color: '#FF9800', type: 'expense' },
  { id: 'sport',      name: 'Спорт',        icon: '💪', color: '#8BC34A', type: 'expense' },
  { id: 'travel',     name: 'Путешествия',  icon: '✈️', color: '#03A9F4', type: 'expense' },
  { id: 'education',  name: 'Образование',  icon: '🎓', color: '#673AB7', type: 'expense' },
  { id: 'pets',       name: 'Животные',     icon: '🐾', color: '#A1887F', type: 'expense' },
  { id: 'other_exp',  name: 'Другое',       icon: '💸', color: '#607D8B', type: 'expense' },
  // Income
  { id: 'salary',     name: 'Зарплата',     icon: '💰', color: '#00C896', type: 'income' },
  { id: 'freelance',  name: 'Фриланс',      icon: '💻', color: '#00BFA5', type: 'income' },
  { id: 'gift',       name: 'Подарок',      icon: '🎁', color: '#F06292', type: 'income' },
  { id: 'other_inc',  name: 'Другое',       icon: '📈', color: '#26A69A', type: 'income' },
]

export function getCategoryById(id: string): Category | undefined {
  return DEFAULT_CATEGORIES.find(c => c.id === id)
}
