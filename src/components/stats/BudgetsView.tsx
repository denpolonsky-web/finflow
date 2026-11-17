import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { categoryName } from '../../db/categories'
import { CategoryIcon } from '../ui/CategoryIcon'
import { Card, Loading } from './Card'
import type { ViewCtx } from './types'
import { formatMoney } from '../../utils/format'
import { budgetRows } from '../../utils/analytics'

/**
 * Бюджеты — месячные лимиты по категориям из настроек: сколько из лимита
 * потрачено, где мы должны быть по календарю и есть ли перерасход.
 */
export function BudgetsView(ctx: ViewCtx) {
  const { txs, range, colors, drill } = ctx
  const budgets = useLiveQuery(() => db.budgets.toArray(), [])
  if (budgets === undefined) return <Loading />

  const rows = budgetRows(budgets, txs, range)
  if (!rows.length) {
    return (
      <div className="text-center py-14">
        <p className="text-4xl mb-2">🎯</p>
        <p className="text-text-secondary text-sm">Лимиты не заданы</p>
        <p className="text-text-secondary/70 text-xs mt-1">Настройки → Бюджеты по категориям</p>
      </div>
    )
  }

  const limit = rows.reduce((s, r) => s + r.budget.amount, 0)
  const spent = rows.reduce((s, r) => s + r.spent, 0)

  return (
    <>
      <Card>
        <p className="text-text-secondary text-xs">Потрачено из лимитов · {range.label}</p>
        <p className="text-3xl font-bold mt-1 text-text-primary">
          {formatMoney(spent)}
          <span className="text-text-secondary text-base font-semibold"> из {formatMoney(limit, true)}</span>
        </p>
      </Card>

      <div className="flex flex-col gap-3">
        {rows.map(r => (
          <button key={r.budget.id}
            onClick={() => drill({
              title: categoryName(r.budget.categoryId),
              subtitle: `${formatMoney(r.spent)} из ${formatMoney(r.budget.amount)}`,
              source: 'period',
              categoryId: r.budget.categoryId,
              match: t => t.categoryId === r.budget.categoryId && t.type === 'expense',
            })}
            className="text-left bg-bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-text-primary text-sm font-medium flex items-center gap-1.5">
                <CategoryIcon id={r.budget.categoryId} size={16} />
                {categoryName(r.budget.categoryId)}
              </p>
              <p className={`text-xs font-semibold ${
                r.status === 'over' ? 'text-accent-red' : r.status === 'warn' ? 'text-accent-yellow' : 'text-accent-green'}`}>
                {r.pct.toFixed(0)}%
              </p>
            </div>
            <div className="relative h-2 rounded-full bg-bg-card2 overflow-hidden">
              <div className={`h-full rounded-full ${
                r.status === 'over' ? 'bg-accent-red' : r.status === 'warn' ? 'bg-accent-yellow' : 'bg-accent-green'}`}
                style={{ width: `${Math.min(100, r.pct)}%` }} />
              {/* метка «где мы должны быть по календарю» */}
              <div className="absolute top-0 bottom-0 w-0.5 bg-white/60" style={{ left: `${r.pace * 100}%` }} />
            </div>
            <div className="flex justify-between mt-2 text-xs">
              <span className="text-text-secondary">
                {formatMoney(r.spent, true)} из {formatMoney(r.budget.amount, true)}
              </span>
              <span style={{ color: r.budget.amount - r.spent >= 0 ? undefined : colors.expense }}
                className={r.budget.amount - r.spent >= 0 ? 'text-text-secondary' : ''}>
                {r.budget.amount - r.spent >= 0
                  ? `осталось ${formatMoney(r.budget.amount - r.spent, true)}`
                  : `перерасход ${formatMoney(r.spent - r.budget.amount, true)}`}
              </span>
            </div>
            {r.status === 'warn' && (
              <p className="text-accent-yellow text-[11px] mt-2">
                Темп выше календарного: прошло {(r.pace * 100).toFixed(0)}% периода
              </p>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
