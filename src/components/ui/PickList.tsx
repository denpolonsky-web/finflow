import { ChevronDown, ChevronUp, Lock } from 'lucide-react'

interface Item<T extends string> {
  id: T
  label: string
  hint?: string
  /** пункт всегда включён, убрать его нельзя */
  locked?: boolean
}

interface Props<T extends string> {
  /** весь реестр, в порядке по умолчанию */
  items: Item<T>[]
  /** включённые пункты — в том порядке, в котором их показывать */
  value: T[]
  onChange: (next: T[]) => void
  /** стрелки «выше / ниже»; без них порядок берётся из реестра */
  reorder?: boolean
  /** меньше этого числа включённых оставить нельзя */
  min?: number
}

/**
 * Список «что показывать и в каком порядке»: галочка включает пункт,
 * стрелки двигают его. Один и тот же для нижней навигации, разделов аналитики
 * и периодов — чтобы настройка везде выглядела и вела себя одинаково.
 *
 * Включённые идут первыми в своём порядке, выключенные — следом в порядке
 * реестра: так видно и что есть сейчас, и что ещё можно добавить.
 */
export function PickList<T extends string>({ items, value, onChange, reorder = false, min = 1 }: Props<T>) {
  const meta = new Map(items.map(i => [i.id, i]))
  const on = value.filter(id => meta.has(id))
  const off = items.filter(i => !on.includes(i.id)).map(i => i.id)
  // без стрелок включённые тоже показываем в порядке реестра — иначе пункт
  // прыгал бы по списку при каждом нажатии на галочку
  const rows = reorder ? [...on, ...off] : items.map(i => i.id)

  function toggle(id: T) {
    if (on.includes(id)) {
      if (meta.get(id)?.locked || on.length <= min) return
      onChange(on.filter(x => x !== id))
    } else {
      onChange(reorder ? [...on, id] : items.map(i => i.id).filter(x => x === id || on.includes(x)))
    }
  }

  function move(id: T, dir: -1 | 1) {
    const i = on.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= on.length) return
    const next = [...on]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(id => {
        const it = meta.get(id)!
        const enabled = on.includes(id)
        const idx = on.indexOf(id)
        const lastOne = enabled && on.length <= min
        return (
          <div key={id}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 ${enabled ? 'bg-bg-card2' : 'bg-bg-card2/40'}`}>
            <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
              <input type="checkbox" checked={enabled} disabled={it.locked || lastOne}
                onChange={() => toggle(id)}
                className="mt-0.5 accent-[#6C63FF] flex-none" />
              <span className="min-w-0">
                <span className={`text-sm flex items-center gap-1.5 ${enabled ? 'text-text-primary' : 'text-text-secondary'}`}>
                  {it.label}
                  {it.locked && <Lock size={10} className="text-text-secondary" aria-label="Закреплено" />}
                </span>
                {it.hint && <span className="text-text-secondary/70 text-[11px] block leading-snug">{it.hint}</span>}
              </span>
            </label>
            {reorder && enabled && (
              <div className="flex gap-1 flex-none">
                <button onClick={() => move(id, -1)} disabled={idx === 0} aria-label={`Выше: ${it.label}`}
                  className="w-7 h-7 rounded-lg bg-bg-card flex items-center justify-center text-text-secondary disabled:opacity-25">
                  <ChevronUp size={15} />
                </button>
                <button onClick={() => move(id, 1)} disabled={idx === on.length - 1} aria-label={`Ниже: ${it.label}`}
                  className="w-7 h-7 rounded-lg bg-bg-card flex items-center justify-center text-text-secondary disabled:opacity-25">
                  <ChevronDown size={15} />
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
