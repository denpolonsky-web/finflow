import { useState } from 'react'
import { RotateCcw, Ban } from 'lucide-react'
import { SERVICE_CATEGORY_IDS } from '../../db/categories'
import { useCategories } from '../../store/CategoriesContext'
import { MoneyInput } from './MoneyInput'
import { CategoryIcon } from './CategoryIcon'
import { toMinor, minorToInput } from '../../utils/money'
import { EMPTY_FILTERS, type ReportFilters, type LookupMaps } from '../../utils/report'
import type { TransactionType } from '../../types'

/**
 * Панель условий выборки. Одна на весь раздел аналитики: и для готовых
 * разрезов, и для конструктора отчётов. Раньше фильтры жили только
 * в конструкторе, и «Обзор», «Дни», «Категории» отфильтровать было нельзя вовсе.
 */

const chip = (on: boolean) =>
  `flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
    on ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary border border-border'}`

const chipNegative = (on: boolean) =>
  `flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
    on ? 'bg-accent-red text-white' : 'bg-bg-card2 text-text-secondary border border-border'}`

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v]
}

interface Props {
  filters: ReportFilters
  onChange: (next: ReportFilters) => void
  maps: LookupMaps
  /** показывать разрез по профилям (только главной роли) */
  showProfiles: boolean
}

export function FiltersPanel({ filters, onChange, maps, showProfiles }: Props) {
  // «сырые» строки сумм держим рядом: иначе промежуточный ввод («1 2») схлопнется
  const [minDraft, setMinDraft] = useState(() => minorToInput(filters.minAmount))
  const [maxDraft, setMaxDraft] = useState(() => minorToInput(filters.maxAmount))

  // Фильтровать можно и по скрытым категориям: в истории операции по ним остались,
  // и без них выборка за прошлые периоды была бы неполной
  const categories = useCategories().filter(c => !SERVICE_CATEGORY_IDS.has(c.id))

  const patch = (p: Partial<ReportFilters>) => onChange({ ...filters, ...p })

  function reset() {
    onChange(EMPTY_FILTERS)
    setMinDraft(''); setMaxDraft('')
  }

  return (
    <div className="flex flex-col gap-3 bg-bg-card border border-border rounded-2xl p-3">
      <input
        value={filters.search}
        onChange={e => patch({ search: e.target.value })}
        placeholder="Поиск по названию, комментарию, категории"
        className="w-full bg-bg-card2 rounded-xl px-3 py-2 text-text-primary text-xs outline-none placeholder:text-text-muted"
      />

      <div>
        <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Тип операции</p>
        <div className="flex gap-2 flex-wrap">
          {(['expense', 'income', 'transfer'] as TransactionType[]).map(t => (
            <button key={t} onClick={() => patch({ types: toggle(filters.types, t) })}
              className={chip(filters.types.includes(t))}>
              {t === 'expense' ? 'Расход' : t === 'income' ? 'Доход' : 'Перевод'}
            </button>
          ))}
          <button onClick={() => patch({ includeExcluded: !filters.includeExcluded })}
            className={chip(filters.includeExcluded)}>
            + переводы и корректировки
          </button>
        </div>
      </div>

      <div>
        <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Только эти категории</p>
        <div className="flex gap-2 flex-wrap max-h-32 overflow-y-auto">
          {categories.map(c => (
            <button key={c.id} onClick={() => patch({ categoryIds: toggle(filters.categoryIds, c.id) })}
              className={chip(filters.categoryIds.includes(c.id))}>
              <CategoryIcon id={c.id} size={14} /> {c.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5 flex items-center gap-1">
          <Ban size={10} /> Исключить категории
        </p>
        <div className="flex gap-2 flex-wrap max-h-32 overflow-y-auto">
          {categories.map(c => (
            <button key={c.id} onClick={() => patch({ excludeCategoryIds: toggle(filters.excludeCategoryIds, c.id) })}
              className={chipNegative(filters.excludeCategoryIds.includes(c.id))}>
              <CategoryIcon id={c.id} size={14} /> {c.name}
            </button>
          ))}
        </div>
        <p className="text-text-muted text-[10px] mt-1.5">
          Исключение сильнее включения: названная в обоих списках категория не попадёт в выборку.
        </p>
      </div>

      {maps.accounts.length > 0 && (
        <div>
          <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Счета</p>
          <div className="flex gap-2 flex-wrap">
            {maps.accounts.map(a => (
              <button key={a.id} onClick={() => patch({ accountIds: toggle(filters.accountIds, a.id) })}
                className={chip(filters.accountIds.includes(a.id))}>{a.name}</button>
            ))}
          </div>
        </div>
      )}

      {showProfiles && maps.profiles.length > 1 && (
        <div>
          <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Профили</p>
          <div className="flex gap-2 flex-wrap">
            {maps.profiles.map(p => (
              <button key={p.id} onClick={() => patch({ profileIds: toggle(filters.profileIds, p.id) })}
                className={chip(filters.profileIds.includes(p.id))}>{p.emoji} {p.name}</button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <MoneyInput value={minDraft} placeholder="Сумма от" aria-label="Сумма от"
          onChange={v => { setMinDraft(v); patch({ minAmount: v ? toMinor(v) : null }) }}
          className="flex-1 bg-bg-card2 rounded-xl px-3 py-2 text-text-primary text-xs outline-none" />
        <MoneyInput value={maxDraft} placeholder="до" aria-label="Сумма до"
          onChange={v => { setMaxDraft(v); patch({ maxAmount: v ? toMinor(v) : null }) }}
          className="flex-1 bg-bg-card2 rounded-xl px-3 py-2 text-text-primary text-xs outline-none" />
        <button onClick={reset} aria-label="Сбросить условия"
          className="w-9 h-9 rounded-xl bg-bg-card2 flex items-center justify-center text-text-secondary flex-none">
          <RotateCcw size={15} />
        </button>
      </div>
    </div>
  )
}
