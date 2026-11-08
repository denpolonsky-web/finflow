import { Fragment } from 'react'
import { Pencil } from 'lucide-react'
import { categoryName } from '../../db/categories'
import { CategoryIcon } from './CategoryIcon'
import { formatMoney, formatDayKey, formatTime, monthTitle } from '../../utils/format'
import { groupByDay } from '../../utils/txGroups'
import { amountColor, type AmountColors } from '../../utils/uiPrefs'
import type { Transaction } from '../../types'

interface Props {
  items: Transaction[]
  onPick: (tx: Transaction) => void
  colors: AmountColors
  /** счета — чтобы у перевода было видно направление, а не просто «Перевод» */
  accounts?: { id: string; name: string }[]
  /** разделители месяцев — нужны только там, где список длинный (история) */
  showMonths?: boolean
  /**
   * Итог дня справа от даты. Включать только там, где в списке лежат ВСЕ
   * операции дня: итог считается по переданным строкам, и на урезанном
   * списке (пять последних на главной, оборванная страница ленты) он
   * показал бы сумму, которой у дня нет.
   */
  showDayTotal?: boolean
  /** карандаш в правом краю строки */
  showEdit?: boolean
}

/**
 * Список операций, разбитый по дням (и, если нужно, по месяцам).
 *
 * Общий для главной и истории намеренно: раньше у каждой был свой список,
 * и на главной операции шли сплошной лентой без дат. Заодно это единственное
 * место, где цвет суммы берётся из настроек, — иначе настройку пришлось бы
 * дублировать в каждом экране и они бы разъезжались.
 */
export function TxList({
  items, onPick, colors, accounts, showMonths = false, showDayTotal = true, showEdit = false,
}: Props) {
  const groups = groupByDay(items)
  const accName = new Map((accounts ?? []).map(a => [a.id, a.name]))

  /**
   * Вторая строка операции. У перевода вместо бесполезного «Перевод» пишем
   * направление: по списку иначе не понять, деньги ушли или пришли — знака
   * у перевода нет, и это выглядело как трата без минуса.
   *
   * «вне статистики» подписываем явно: такие операции не входят в итог дня,
   * и без пометки сумма рядом с датой не сходилась с тем, что видно в списке.
   */
  function subtitle(tx: Transaction): string {
    const base = tx.type === 'transfer' && (accName.has(tx.accountId) || accName.has(tx.toAccountId ?? ''))
      ? `${accName.get(tx.accountId) ?? '—'} → ${accName.get(tx.toAccountId ?? '') ?? '—'}`
      : categoryName(tx.categoryId)
    /* у перевода пометка не нужна: он и так не меняет итог, и это видно
       по направлению — лишний хвост только зашумлял бы строку */
    const outside = tx.excludeFromStats && tx.type !== 'transfer' ? ' · вне статистики' : ''
    return `${base} · ${formatTime(tx.date)}${outside}`
  }
  /* Границу месяца считаем заранее, отдельным проходом: накапливать её
     переменной прямо в map нельзя — это мутация во время рендера. */
  const rows = groups.map((g, i) => ({
    group: g,
    newMonth: showMonths && (i === 0 || g.month !== groups[i - 1].month),
  }))

  return (
    <div className="flex flex-col gap-4">
      {rows.map(({ group: g, newMonth }) => {
        return (
          <Fragment key={g.date}>
            {newMonth && (
              <div className="flex items-center gap-3 pt-1">
                <p className="text-text-primary text-sm font-bold">{monthTitle(g.month)}</p>
                <div className="h-px bg-border flex-1" />
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-text-secondary text-xs uppercase tracking-widest">
                  {formatDayKey(g.date)}
                </p>
                {showDayTotal && g.total !== 0 && (
                  <p className="text-xs font-semibold"
                    style={{ color: g.total >= 0 ? colors.income : colors.expense }}>
                    {g.total >= 0 ? '+' : '−'}{formatMoney(Math.abs(g.total), true)}
                  </p>
                )}
              </div>
              <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
                {g.items.map((tx, i) => (
                  <button key={tx.id} onClick={() => onPick(tx)}
                    className={`w-full text-left flex items-center gap-3 p-4 active:bg-bg-card2 ${
                      i < g.items.length - 1 ? 'border-b border-border' : ''}`}>
                    <div className="w-10 h-10 rounded-xl bg-bg-card2 flex items-center justify-center text-lg flex-none overflow-hidden">
                      <CategoryIcon id={tx.categoryId} size={26} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-sm font-medium truncate">
                        {tx.title || categoryName(tx.categoryId)}
                      </p>
                      <p className="text-text-muted text-xs truncate">{subtitle(tx)}</p>
                    </div>
                    {/* сумма операции — ТОЧНАЯ, без сокращения: «182,4 тыс. ₽»
                        вместо 182 350 ₽ скрывает ровно то, за чем сюда и пришли.
                        Сокращение остаётся в итогах дня и в плитках. */}
                    <p className="text-sm font-semibold flex-none"
                      style={{ color: amountColor(tx.type, colors) }}>
                      {tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}
                      {formatMoney(tx.amount)}
                    </p>
                    {showEdit && <Pencil size={13} className="text-text-muted flex-none" />}
                  </button>
                ))}
              </div>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
