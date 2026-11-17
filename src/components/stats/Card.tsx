import type { ReactNode } from 'react'

interface Props {
  title?: string
  /** мелкая строка под заголовком: что на графике и что будет по нажатию */
  hint?: string
  /** правый угол шапки — обычно переключатель вида */
  right?: ReactNode
  children: ReactNode
}

/** Карточка раздела аналитики: заголовок, подсказка, переключатель в углу. */
export function Card({ title, hint, right, children }: Props) {
  return (
    <div className="bg-bg-card border border-border rounded-2xl p-4">
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            {title && <p className="text-text-secondary text-xs uppercase tracking-widest">{title}</p>}
            {hint && <p className="text-text-secondary/70 text-[11px] mt-1 leading-snug">{hint}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

/** Читаем из базы. Отдельно от «Нет данных»: иначе на первом кадре каждый
 *  раздел утверждал, что за период ничего нет. */
export function Loading() {
  return <p className="text-text-secondary text-xs text-center py-16">Загружаем…</p>
}

export function Empty({ text = 'Нет данных за период' }: { text?: string }) {
  return (
    <div className="text-center py-16">
      <p className="text-4xl mb-2">📊</p>
      <p className="text-text-secondary">{text}</p>
    </div>
  )
}
