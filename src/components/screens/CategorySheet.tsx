import { useState } from 'react'
import { Loader2, Trash2, EyeOff, Eye } from 'lucide-react'
import {
  createCategory, updateCategory, deleteCategory, showCategory, isBuiltIn, isImageIcon,
} from '../../db/categories'
import { useApp } from '../../store/AppContext'
import { Sheet, Field, inputCls, primaryBtn } from '../ui/Sheet'
import type { Category } from '../../types'

const ICONS = [
  '🏷️', '🛒', '🍔', '🚇', '🏠', '📱', '💊', '🎮', '👔', '📦', '💪', '✈️', '🎓', '🐾',
  '🔁', '💸', '💰', '💻', '🎁', '📈', '🚗', '⛽', '🧾', '🔧', '🎨', '📚', '☕', '🍺',
]

const COLORS = [
  '#4CAF50', '#FF8C42', '#2196F3', '#795548', '#00BCD4', '#E91E63', '#9C27B0',
  '#FF5722', '#FF9800', '#8BC34A', '#03A9F4', '#673AB7', '#607D8B', '#00C896',
]

interface Props {
  /** null — создание новой */
  category: Category | null
  onClose: () => void
}

/**
 * Монтируется только когда открыт (с `key`), поэтому начальное состояние
 * задаётся прямо в useState — как в ProfileSheet и TransactionSheet.
 */
export function CategorySheet({ category, onClose }: Props) {
  const { showToast } = useApp()
  const isEdit = Boolean(category)
  const builtIn = category ? isBuiltIn(category.id) : false

  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState(category?.icon ?? '🏷️')
  const [color, setColor] = useState(category?.color ?? COLORS[0])
  const [type, setType] = useState<'expense' | 'income'>(
    category?.type === 'income' ? 'income' : 'expense',
  )
  const [essential, setEssential] = useState(Boolean(category?.essential))
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      if (category) {
        await updateCategory(category.id, { name, icon, color, type, essential })
        showToast('Категория обновлена')
      } else {
        await createCategory({ name, icon, color, type, essential })
        showToast('Категория добавлена')
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!category || busy) return
    setBusy(true)
    try {
      const res = await deleteCategory(category.id)
      showToast(
        res === 'deleted' ? 'Категория удалена'
          : 'Категория скрыта — на ней есть операции или она встроенная',
      )
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open title={isEdit ? 'Категория' : 'Новая категория'}
      subtitle={builtIn ? 'Встроенная' : undefined} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Название">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="Например, Стройматериалы" className={inputCls} autoFocus={!isEdit} />
        </Field>

        <Field label="Тип">
          <div className="grid grid-cols-2 gap-2">
            {([['expense', 'Расход'], ['income', 'Доход']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setType(id)} disabled={builtIn}
                className={`py-2.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 ${
                  type === id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                {label}
              </button>
            ))}
          </div>
          {builtIn && (
            <p className="text-text-muted text-[11px] mt-1.5">
              У встроенной категории тип не меняется: на него опираются уже заведённые операции.
            </p>
          )}
        </Field>

        <Field label="Значок">
          {/* У маркетплейсов значок — логотип, а не эмодзи. Показываем его
              отдельно: иначе в сетке ничего не подсвечено и кажется, что
              значок не выбран. Выбор эмодзи логотип заменит. */}
          {isImageIcon(icon) && (
            <div className="flex items-center gap-2 mb-2">
              <img src={icon} alt="" className="w-10 h-10 rounded-xl object-cover" />
              <p className="text-text-muted text-[11px]">
                Сейчас стоит логотип. Выберите эмодзи, чтобы заменить его.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {ICONS.map(ic => (
              <button key={ic} onClick={() => setIcon(ic)}
                className={`w-10 h-10 rounded-xl text-lg flex items-center justify-center ${
                  icon === ic ? 'bg-accent' : 'bg-bg-card2'}`}>
                {ic}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Цвет">
          <div className="flex flex-wrap gap-2">
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} aria-label={`Цвет ${c}`}
                className={`w-9 h-9 rounded-full ${color === c ? 'ring-2 ring-white' : ''}`}
                style={{ background: c }} />
            ))}
          </div>
        </Field>

        {type === 'expense' && (
          <label className="flex items-start gap-3 bg-bg-card2 rounded-xl p-3 cursor-pointer">
            <input type="checkbox" checked={essential}
              onChange={e => setEssential(e.target.checked)}
              className="mt-0.5 accent-[#6C63FF]" />
            <span className="text-text-secondary text-xs">
              Обязательная трата. На этом делении строится «Структура расходов»:
              что нельзя отключить против того, что можно.
            </span>
          </label>
        )}

        <button onClick={save} disabled={busy || !name.trim()}
          className={`${primaryBtn} flex items-center justify-center gap-2`}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          {isEdit ? 'Сохранить' : 'Добавить'}
        </button>

        {isEdit && category && (
          category.isArchived ? (
            <button onClick={() => { void showCategory(category.id); onClose() }} disabled={busy}
              className="w-full h-11 rounded-xl bg-bg-card2 text-text-primary text-sm font-semibold flex items-center justify-center gap-2">
              <Eye size={15} /> Показать снова
            </button>
          ) : (
            <button onClick={remove} disabled={busy}
              className="w-full h-11 rounded-xl bg-accent-red/10 text-accent-red text-sm font-semibold flex items-center justify-center gap-2">
              {builtIn ? <><EyeOff size={15} /> Скрыть из выбора</> : <><Trash2 size={15} /> Удалить</>}
            </button>
          )
        )}

        <p className="text-text-muted text-[11px]">
          Встроенные категории скрываются, но не удаляются: на них ссылаются прошлые
          операции, и без них они остались бы без подписи.
        </p>
      </div>
    </Sheet>
  )
}
