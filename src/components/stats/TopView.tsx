import { useMemo } from 'react'
import { categoryName } from '../../db/categories'
import { CategoryIcon } from '../ui/CategoryIcon'
import { Card, Empty } from './Card'
import type { ViewCtx } from './types'
import { formatDayKey, formatMoney, isoDateOnly } from '../../utils/format'
import { statsOnly, topExpenses, totals } from '../../utils/analytics'
import { useApp } from '../../store/AppContext'

const LIMIT = 20

/**
 * Крупные траты периода. Отвечает на вопрос «куда делись деньги» точнее,
 * чем категории: одна покупка часто и есть вся разница между месяцами.
 *
 * Нажатие открывает саму операцию на правку — проваливаться дальше некуда,
 * это уже конечная точка.
 */
export function TopView(ctx: ViewCtx) {
  const { txs, colors, range } = ctx
  const { setEditTx } = useApp()

  const top = useMemo(() => topExpenses(txs, LIMIT), [txs])
  const t = totals(txs)
  const shown = top.reduce((s, x) => s + x.amount, 0)
  const all = statsOnly(txs).filter(x => x.type === 'expense').length

  if (!top.length) return <Empty text="Расходов за период нет" />

  return (
    <>
      <Card>
        <p className="text-text-secondary text-xs">
          {top.length < all ? `${top.length} крупнейших трат` : 'Все траты'} · {range.label}
        </p>
        <p className="text-3xl font-bold mt-1" style={{ color: colors.expense }}>{formatMoney(shown)}</p>
        {t.expense > 0 && (
          <p className="text-text-secondary text-xs mt-1">
            {((shown / t.expense) * 100).toFixed(0)}% всех расходов периода
            {top.length < all && ` · остальные ${all - top.length} — ${formatMoney(t.expense - shown, true)}`}
          </p>
        )}
      </Card>

      <Card title="Самые крупные" hint="Нажмите на трату — откроется сама операция">
        <div className="flex flex-col gap-2.5">
          {top.map((x, i) => (
            <button key={x.id} onClick={() => setEditTx(x)}
              className="flex items-center gap-3 text-left active:scale-[0.99] transition-transform">
              <span className="w-5 text-text-secondary/70 text-[11px] tabular-nums flex-none">{i + 1}</span>
              <CategoryIcon id={x.categoryId} size={22} />
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm truncate">
                  {x.title || categoryName(x.categoryId)}
                </p>
                <p className="text-text-secondary text-[11px] truncate">
                  {categoryName(x.categoryId)} · {formatDayKey(isoDateOnly(x.date))}
                </p>
              </div>
              <div className="flex-none text-right">
                <p className="text-sm font-semibold" style={{ color: colors.expense }}>
                  {formatMoney(x.amount)}
                </p>
                {t.expense > 0 && (
                  <p className="text-text-secondary text-[10px]">
                    {((x.amount / t.expense) * 100).toFixed(1)}%
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </Card>
    </>
  )
}
