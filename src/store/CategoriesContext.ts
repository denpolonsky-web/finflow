import { createContext, useContext } from 'react'
import { DEFAULT_CATEGORIES } from '../db/categories'
import type { Category } from '../types'

/**
 * Контекст и хук отдельно от провайдера: файл, экспортирующий и компонент,
 * и функции, ломает fast refresh.
 *
 * Значение по умолчанию — встроенные категории, чтобы хук был безопасен
 * и вне провайдера (например, в изолированном тесте компонента).
 */
export const CategoriesCtx = createContext<Category[]>(DEFAULT_CATEGORIES)

/** Весь справочник, включая скрытые. Для выбора при вводе — `selectableCategories`. */
export function useCategories(): Category[] {
  return useContext(CategoriesCtx)
}
