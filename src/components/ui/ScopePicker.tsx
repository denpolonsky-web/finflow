import { Users } from 'lucide-react'
import { useProfile } from '../../store/ProfileContext'

/**
 * Переключатель разреза: весь кабинет / только свои / конкретный профиль.
 * «Стакать вместе или смотреть раздельно» — одним нажатием, а не через
 * конструктор отчётов.
 *
 * Показывается только главной роли и только когда профилей больше одного:
 * ограниченная роль видит исключительно себя, и переключателя у неё нет —
 * не потому что он спрятан, а потому что `scope` всё равно отфильтрует.
 */
export function ScopePicker() {
  const { profiles, profile, viewScope, setViewScope, canSwitchScope } = useProfile()
  if (!canSwitchScope) return null

  const others = profiles.filter(p => p.id !== profile?.id)

  const chip = (on: boolean) =>
    `flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
      on ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary border border-border'}`

  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
      <Users size={13} className="text-text-muted flex-none" />
      <button onClick={() => setViewScope('all')} className={chip(viewScope === 'all')}>
        Вместе
      </button>
      <button onClick={() => setViewScope('mine')} className={chip(viewScope === 'mine')}>
        Только мои
      </button>
      {others.map(p => (
        <button key={p.id} onClick={() => setViewScope(p.id)} className={chip(viewScope === p.id)}>
          {p.emoji} {p.name}
        </button>
      ))}
    </div>
  )
}
