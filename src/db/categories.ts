import { v4 as uuid } from 'uuid'
import { db } from './index'
import { enqueue } from './queue'
import type { Category, CategoryRow } from '../types'

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
  // Маркетплейсы — отдельными категориями: по ним идёт заметная доля трат,
  // и раньше всё это сваливалось в «Покупки». Иконка здесь — путь к картинке,
  // а не эмодзи; как это устроено, см. `isImageIcon` ниже.
  { id: 'ozon',          name: 'Озон',         icon: '/shops/ozon.png', color: '#005BFF', type: 'expense' },
  { id: 'wb',            name: 'Wildberries',  icon: '/shops/wb.png',   color: '#CB11AB', type: 'expense' },
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

/** Служебные категории: не редактируются, не скрываются, в выборе не показываются. */
export const SERVICE_CATEGORY_IDS = new Set([TRANSFER_CATEGORY_ID, ADJUST_EXPENSE_ID, ADJUST_INCOME_ID])

export const isBuiltIn = (id: string) => DEFAULT_CATEGORIES.some(c => c.id === id)

/**
 * Встроенные + пользовательские. Чистая функция, покрыта тестами.
 *
 * Строка из базы с id встроенной категории — это ПЕРЕОПРЕДЕЛЕНИЕ: пользователь
 * переименовал, перекрасил или скрыл её. Сама встроенная при этом никуда
 * не девается, поэтому старые операции не теряют подпись.
 *
 * Служебные категории защищены от изменений здесь, а не в интерфейсе: иначе
 * переименованный «Перевод» разъехался бы с логикой, которая ищет его по id.
 */
export function mergeCategories(rows: CategoryRow[]): Category[] {
  const overrides = new Map(rows.filter(r => !r.deletedAt).map(r => [r.id, r]))

  /**
   * Встроенные нумеруются по индексу в DEFAULT_CATEGORIES, свои идут ПОСЛЕ них.
   * Без явной нумерации у встроенных sortOrder был undefined (→ 0), и выбор
   * при вводе операции схлопывался в алфавит: «Другое» всплывало наверх,
   * «Продукты» падали в середину списка. Курированный порядок сохраняем.
   */
  const builtIns: Category[] = DEFAULT_CATEGORIES.map((base, i) => {
    const o = overrides.get(base.id)
    if (!o || SERVICE_CATEGORY_IDS.has(base.id)) return { ...base, sortOrder: i }
    return {
      ...base,
      name: o.name || base.name,
      icon: o.icon || base.icon,
      color: o.color || base.color,
      essential: o.essential ?? base.essential,
      isArchived: o.isArchived,
      sortOrder: i,
    }
  })

  const offset = DEFAULT_CATEGORIES.length
  const custom: Category[] = rows
    .filter(r => !r.deletedAt && r.isCustom === 1 && !isBuiltIn(r.id))
    .map(r => ({
      id: r.id, name: r.name, icon: r.icon, color: r.color, type: r.type,
      essential: r.essential, isArchived: r.isArchived, isCustom: 1 as const,
      sortOrder: offset + (r.sortOrder ?? 0),
    }))

  return [...builtIns, ...custom]
}

/**
 * Реестр, из которого читают синхронные хелперы.
 *
 * Зачем он: `categoryName` и `getCategory` зовутся из чистых утилит
 * (`analytics.ts`, `report.ts`) и из десятка экранов. Сделать их асинхронными
 * значило бы переписать всё приложение, поэтому список держим в памяти
 * и обновляем из базы в одном месте — `CategoriesProvider`.
 *
 * Стартовое значение — встроенные категории: до загрузки из базы подписи
 * уже корректны, и приложение работает даже если таблица пуста.
 */
let registry = new Map(DEFAULT_CATEGORIES.map(c => [c.id, c]))
let registryList: Category[] = DEFAULT_CATEGORIES

export function setCategoryRegistry(list: Category[]): void {
  registryList = list
  registry = new Map(list.map(c => [c.id, c]))
}

/** Текущий справочник целиком, включая скрытые. */
export const allCategories = (): Category[] => registryList

export function getCategory(id: string): Category | undefined {
  return registry.get(id)
}

export function categoryIcon(id: string): string {
  return registry.get(id)?.icon ?? '💳'
}

/**
 * Иконка категории — это либо эмодзи, либо путь к картинке в `public/`.
 * Отличаем по ведущему слэшу: эмодзи с него начаться не может, а свои
 * категории пользователь заводит только с эмодзи, так что ложных срабатываний
 * нет. Рисует это `CategoryIcon`, текстом такую иконку выводить нельзя —
 * иначе в списке появится сырой путь вместо логотипа.
 */
export function isImageIcon(icon: string): boolean {
  return icon.startsWith('/')
}

export function categoryName(id: string): string {
  return registry.get(id)?.name ?? 'Без категории'
}

export function categoryColor(id: string): string {
  return registry.get(id)?.color ?? '#607D8B'
}

/** Категории, доступные пользователю при выборе: без служебных и без скрытых. */
export function selectableCategories(type: 'expense' | 'income'): Category[] {
  return registryList
    .filter(c => (c.type === type || c.type === 'both')
      && !SERVICE_CATEGORY_IDS.has(c.id)
      && !c.isArchived)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
}

// ─────────────────────────────────────────────────────────────────────────────
// Правка справочника
// ─────────────────────────────────────────────────────────────────────────────

export interface CategoryInput {
  name: string
  icon: string
  color: string
  type: 'expense' | 'income'
  essential?: boolean
}

async function saveRow(row: CategoryRow): Promise<void> {
  await db.categories.put(row)
  await enqueue('category', row.id, 'upsert', row)
}

export async function createCategory(i: CategoryInput): Promise<CategoryRow> {
  const now = new Date().toISOString()
  const row: CategoryRow = {
    // префикс, чтобы свой id никогда не столкнулся со встроенным
    id: `c_${uuid()}`,
    name: i.name.trim() || 'Без названия',
    icon: i.icon || '🏷️',
    color: i.color || '#607D8B',
    type: i.type,
    essential: i.essential ?? false,
    isArchived: 0,
    isCustom: 1,
    sortOrder: await db.categories.count(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  await saveRow(row)
  return row
}

/**
 * Правка категории. Для встроенной создаётся строка-переопределение с тем же id:
 * сама встроенная остаётся в коде, поэтому исторические операции не теряют подпись.
 */
export async function updateCategory(id: string, patch: Partial<CategoryInput> & { isArchived?: 0 | 1 }): Promise<void> {
  if (SERVICE_CATEGORY_IDS.has(id)) return        // служебные не трогаем
  const now = new Date().toISOString()
  const existing = await db.categories.get(id)
  const base = existing ?? registry.get(id)
  if (!base) return

  await saveRow({
    id,
    name: patch.name?.trim() || base.name,
    icon: patch.icon || base.icon,
    color: patch.color || base.color,
    type: (patch.type ?? base.type) as CategoryRow['type'],
    essential: patch.essential ?? base.essential ?? false,
    isArchived: patch.isArchived ?? (existing?.isArchived ?? 0),
    isCustom: existing?.isCustom ?? (isBuiltIn(id) ? 0 : 1),
    sortOrder: existing?.sortOrder ?? (registry.get(id)?.sortOrder ?? 0),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
  })
}

export const hideCategory = (id: string) => updateCategory(id, { isArchived: 1 })
export const showCategory = (id: string) => updateCategory(id, { isArchived: 0 })

/**
 * Насовсем удалить можно только свою категорию и только если на ней нет операций:
 * иначе они осиротеют и в разрезах превратятся в «Без категории».
 */
export async function deleteCategory(id: string): Promise<'deleted' | 'hidden' | 'blocked'> {
  if (SERVICE_CATEGORY_IDS.has(id) || isBuiltIn(id)) {
    await hideCategory(id)
    return 'hidden'                               // встроенную только прячем
  }
  const used = await db.transactions.where('categoryId').equals(id).count()
  if (used > 0) {
    await hideCategory(id)
    return 'hidden'
  }
  await db.categories.delete(id)
  await enqueue('category', id, 'delete', null)
  return 'deleted'
}
