import type { ReactNode } from 'react'

interface Option<T extends string | number> {
  id: T
  label: ReactNode
  /** подпись для экранного диктора, когда на кнопке только значок */
  title?: string
}

interface Props<T extends string | number> {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  /** что переключаем — для экранного диктора */
  label: string
}

/**
 * Компактный переключатель «один из нескольких» — для вида графика.
 * Стоит в правом углу карточки, поэтому маленький и без рамки у пунктов.
 */
export function Segmented<T extends string | number>({ options, value, onChange, label }: Props<T>) {
  return (
    <div role="group" aria-label={label} className="flex bg-bg-card2 rounded-lg p-0.5 flex-none">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} title={o.title} aria-label={o.title}
          aria-pressed={value === o.id}
          className={`h-7 min-w-7 px-2 rounded-md text-[11px] font-semibold flex items-center justify-center transition-colors ${
            value === o.id ? 'bg-accent text-white' : 'text-text-secondary'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
