import 'fake-indexeddb/auto'
import {
  mergeCategories, setCategoryRegistry, getCategory, categoryName, categoryIcon,
  selectableCategories, isBuiltIn, SERVICE_CATEGORY_IDS,
  DEFAULT_CATEGORIES, TRANSFER_CATEGORY_ID,
  createCategory, updateCategory, deleteCategory, hideCategory, showCategory,
} from '../src/db/categories'
import { db } from '../src/db'
import type { CategoryRow } from '../src/types'

const checks: [string, boolean, string][] = []
const eq = (name: string, got: unknown, want: unknown) =>
  checks.push([name, JSON.stringify(got) === JSON.stringify(want), `получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`])

const row = (over: Partial<CategoryRow>): CategoryRow => ({
  id: 'x', name: 'X', icon: '🏷️', color: '#000', type: 'expense',
  isArchived: 0, isCustom: 1, sortOrder: 0,
  createdAt: '', updatedAt: '', deletedAt: null, ...over,
})

// ── Слияние встроенных и пользовательских ───────────────────────────────────
eq('пустая таблица — только встроенные', mergeCategories([]).length, DEFAULT_CATEGORIES.length)
eq('встроенные не теряются', mergeCategories([]).find(c => c.id === 'groceries')?.name, 'Продукты')

// переопределение встроенной: строка с тем же id
const renamed = mergeCategories([row({ id: 'groceries', name: 'Еда домой', icon: '🥦', isCustom: 0 })])
eq('встроенная переименована', renamed.find(c => c.id === 'groceries')?.name, 'Еда домой')
eq('значок переопределён', renamed.find(c => c.id === 'groceries')?.icon, '🥦')
eq('переопределение не плодит дубль', renamed.filter(c => c.id === 'groceries').length, 1)
eq('встроенная не превратилась в свою', renamed.find(c => c.id === 'groceries')?.isCustom, undefined)
eq('остальные встроенные не тронуты', renamed.find(c => c.id === 'food')?.name, 'Кафе и еда')

// своя категория добавляется в конец
const withCustom = mergeCategories([row({ id: 'c_1', name: 'Стройматериалы' })])
eq('своя категория появилась', withCustom.find(c => c.id === 'c_1')?.name, 'Стройматериалы')
eq('своя помечена как своя', withCustom.find(c => c.id === 'c_1')?.isCustom, 1)
eq('встроенные на месте', withCustom.length, DEFAULT_CATEGORIES.length + 1)

// удалённые строки игнорируются
eq('tombstone не показывается', mergeCategories([row({ id: 'c_2', deletedAt: '2026-01-01' })]).length, DEFAULT_CATEGORIES.length)

// служебные защищены от переопределения
const hackService = mergeCategories([row({ id: TRANSFER_CATEGORY_ID, name: 'ВЗЛОМ', isCustom: 0 })])
eq('служебную переименовать нельзя', hackService.find(c => c.id === TRANSFER_CATEGORY_ID)?.name, 'Перевод')
eq('служебные распознаются', SERVICE_CATEGORY_IDS.has(TRANSFER_CATEGORY_ID), true)
eq('встроенная распознаётся', isBuiltIn('groceries'), true)
eq('своя не считается встроенной', isBuiltIn('c_1'), false)

// ── Реестр: синхронные хелперы видят изменения ──────────────────────────────
setCategoryRegistry(mergeCategories([row({ id: 'groceries', name: 'Еда домой', icon: '🥦', isCustom: 0 })]))
eq('categoryName читает из реестра', categoryName('groceries'), 'Еда домой')
eq('categoryIcon читает из реестра', categoryIcon('groceries'), '🥦')
eq('getCategory читает из реестра', getCategory('groceries')?.name, 'Еда домой')
eq('неизвестная категория не роняет', categoryName('нет-такой'), 'Без категории')

// порядок выбора: курированный, а не алфавитный
setCategoryRegistry(mergeCategories([]))
const picks = selectableCategories('expense').filter(c => c.type === 'expense').map(c => c.id)
eq('порядок выбора курированный, а не алфавитный', picks[0], 'groceries')
eq('«Другое» в конце, а не в начале', picks.indexOf('other_exp'), picks.length - 1)
// своя категория встаёт после всех встроенных
const withCustomPick = mergeCategories([row({ id: 'c_z', name: 'Моя', isCustom: 1 })])
setCategoryRegistry(withCustomPick)
const picksCustom = selectableCategories('expense').map(c => c.id)
eq('своя после встроенных', picksCustom[picksCustom.length - 1], 'c_z')

// скрытая не предлагается при вводе, но подпись у неё остаётся
setCategoryRegistry(mergeCategories([row({ id: 'food', name: 'Кафе и еда', isArchived: 1, isCustom: 0 })]))
eq('скрытая не в выборе', selectableCategories('expense').some(c => c.id === 'food'), false)
eq('подпись скрытой сохранилась', categoryName('food'), 'Кафе и еда')
eq('служебная не в выборе', selectableCategories('expense').some(c => SERVICE_CATEGORY_IDS.has(c.id)), false)
eq('доходные не в расходном выборе', selectableCategories('expense').some(c => c.type === 'income'), false)

setCategoryRegistry(mergeCategories([]))   // вернём как было

// ── CRUD в базе ─────────────────────────────────────────────────────────────
await db.categories.clear()
await db.syncQueue.clear()

const created = await createCategory({ name: 'Стройматериалы', icon: '🔧', color: '#607D8B', type: 'expense' })
eq('своя категория сохранена', (await db.categories.get(created.id))?.name, 'Стройматериалы')
eq('своей выдан префикс c_', created.id.startsWith('c_'), true)
eq('своя помечена isCustom', created.isCustom, 1)
eq('создание попало в очередь синка', (await db.syncQueue.where('entityId').equals(created.id).count()) > 0, true)

await updateCategory(created.id, { name: 'Стройка' })
eq('правка сохранилась', (await db.categories.get(created.id))?.name, 'Стройка')

// правка встроенной создаёт строку-переопределение
await updateCategory('transport', { name: 'Проезд' })
const override = await db.categories.get('transport')
eq('переопределение встроенной создано', override?.name, 'Проезд')
eq('переопределение не считается своим', override?.isCustom, 0)

// скрытие и возврат
await hideCategory('transport')
eq('встроенная скрыта', (await db.categories.get('transport'))?.isArchived, 1)
await showCategory('transport')
eq('встроенная возвращена', (await db.categories.get('transport'))?.isArchived, 0)

// служебные не меняются
await updateCategory(TRANSFER_CATEGORY_ID, { name: 'ВЗЛОМ' })
eq('служебная в базу не записана', await db.categories.get(TRANSFER_CATEGORY_ID), undefined)

// удаление: встроенную только прячем
eq('встроенная не удаляется, а прячется', await deleteCategory('transport'), 'hidden')
eq('встроенная осталась в базе', Boolean(await db.categories.get('transport')), true)

// своя без операций удаляется насовсем
eq('своя без операций удалена', await deleteCategory(created.id), 'deleted')
eq('своей больше нет в базе', await db.categories.get(created.id), undefined)

// своя с операциями — только прячется, иначе операции осиротеют
const used = await createCategory({ name: 'С операциями', icon: '🧾', color: '#000', type: 'expense' })
await db.transactions.put({
  id: 'tx-cat', type: 'expense', amount: 100, categoryId: used.id, accountId: 'a',
  title: '', date: '2026-01-01T00:00:00.000Z', excludeFromStats: 0, source: 'manual',
  createdAt: '', updatedAt: '', deletedAt: null,
})
eq('своя с операциями прячется, а не удаляется', await deleteCategory(used.id), 'hidden')
eq('операция не осиротела', Boolean(await db.categories.get(used.id)), true)

let failed = 0
for (const [name, pass, d] of checks) { console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${pass ? '' : ' — ' + d}`); if (!pass) failed++ }
console.log(`\n${checks.length - failed}/${checks.length} проверок справочника категорий пройдено`)
process.exit(failed ? 1 : 0)
