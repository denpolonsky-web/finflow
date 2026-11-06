import React, { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { mergeCategories, setCategoryRegistry } from '../db/categories'
import { CategoriesCtx } from './CategoriesContext'

/**
 * Держит справочник категорий в памяти и обновляет его при изменениях в базе.
 *
 * Зачем провайдер, а не просто хук: `categoryName`, `categoryIcon` и
 * `getCategory` зовутся из чистых утилит (`analytics.ts`, `report.ts`) и из
 * десятка экранов. Сделать их асинхронными значило бы переписать приложение
 * целиком, поэтому справочник живёт в модульном реестре, а обновляется ровно
 * в одном месте — здесь.
 *
 * Реестр заполняется в теле `useMemo`, то есть ДО рендера детей: иначе первый
 * кадр показал бы встроенные подписи вместо пользовательских. Это кэш,
 * вычисляемый из `rows` детерминированно, повторный вызов безвреден.
 */
export function CategoriesProvider({ children }: { children: React.ReactNode }) {
  const rows = useLiveQuery(() => db.categories.toArray(), [], [])

  const list = useMemo(() => {
    const merged = mergeCategories(rows)
    setCategoryRegistry(merged)
    return merged
  }, [rows])

  return <CategoriesCtx.Provider value={list}>{children}</CategoriesCtx.Provider>
}
