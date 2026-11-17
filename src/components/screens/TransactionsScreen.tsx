import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, ChevronLeft, ChevronRight, Trash2, RotateCcw } from 'lucide-react'
import { db } from '../../db'
import { categoryName } from '../../db/categories'
import {
  restoreTransaction, dropFromTrash, emptyTrash, TRASH_KEEP_DAYS, LedgerError,
} from '../../db/transactions'
import { CategoryIcon } from '../ui/CategoryIcon'
import { formatDate, formatMoney, formatSigned, isoDateOnly, formatDayKey, plural } from '../../utils/format'
import { getRange } from '../../utils/period'
import { totals } from '../../utils/analytics'
import { useApp } from '../../store/AppContext'
import { useAccounts } from '../../hooks/useBalances'
import { useProfile } from '../../store/ProfileContext'
import { ScopePicker } from '../ui/ScopePicker'
import { TxList } from '../ui/TxList'
import { cutAtDayEnd } from '../../utils/txGroups'
import { loadAmountColors, loadPeriods, PERIOD_OPTIONS } from '../../utils/uiPrefs'
import type { PeriodId, TrashedTransaction } from '../../types'

/**
 * `all` — вся история без ограничения по дате, и это положение по умолчанию.
 * Раньше экран открывался на текущем месяце, и чтобы увидеть прошлые операции,
 * нужно было догадаться листать период стрелками.
 */
type Tab = 'all' | 'trash' | PeriodId

type Filter = 'all' | 'expense' | 'income' | 'transfer'

/** Сколько операций дорисовываем за один шаг бесконечной прокрутки. */
const PAGE = 40

/**
 * Корзина: удалённые операции с кнопкой «Вернуть».
 *
 * Отдельный список, а не `TxList`: группировать по дню операции тут не по чему —
 * важна дата удаления, а не дата самой траты. И действие другое: не правка,
 * а возврат.
 */
function TrashList({ items, accounts }: {
  items: TrashedTransaction[] | undefined
  accounts: { id: string; name: string }[]
}) {
  const { showToast } = useApp()
  const accName = new Map(accounts.map(a => [a.id, a.name]))

  async function restore(id: string) {
    try {
      await restoreTransaction(id)
      showToast('Операция возвращена')
    } catch (e) {
      showToast(e instanceof LedgerError ? e.message : 'Не удалось вернуть операцию')
    }
  }

  if (items === undefined) {
    return <p className="text-text-muted text-xs text-center py-16">Загружаем…</p>
  }
  if (!items.length) {
    return (
      <div className="text-center py-16">
        <p className="text-4xl mb-2">🗑️</p>
        <p className="text-text-secondary">Корзина пуста</p>
        <p className="text-text-muted text-xs mt-1">
          Удалённые операции лежат здесь {TRASH_KEEP_DAYS} дней, потом исчезают сами
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-text-muted text-[11px]">
          Хранится {TRASH_KEEP_DAYS} дней. Возврат пересобирает проводки — баланс сходится.
        </p>
        <button
          onClick={() => {
            if (confirm(`Очистить корзину? ${items.length} ${plural(items.length, 'операция исчезнет', 'операции исчезнут', 'операций исчезнет')} насовсем.`)) {
              void emptyTrash()
            }
          }}
          className="text-accent-red text-xs underline flex-none">
          Очистить
        </button>
      </div>

      <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
        {items.map((it, i) => (
          <div key={it.id}
            className={`flex items-center gap-3 p-4 ${i < items.length - 1 ? 'border-b border-border' : ''}`}>
            <div className="w-10 h-10 rounded-xl bg-bg-card2 flex items-center justify-center flex-none overflow-hidden opacity-60">
              <CategoryIcon id={it.tx.categoryId} size={26} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-text-secondary text-sm font-medium truncate line-through">
                {it.tx.title || categoryName(it.tx.categoryId)}
              </p>
              {/* две строки вместо одной: в строку это не влезало и обрывалось
                  на «Сегодня · …», а дата удаления тут и есть главное */}
              <p className="text-text-muted text-[11px] truncate">
                {formatDayKey(isoDateOnly(it.tx.date))} · {accName.get(it.tx.accountId) ?? 'счёт удалён'}
              </p>
              <p className="text-text-muted text-[11px] truncate">
                удалена {formatDate(it.deletedAt).toLowerCase()}
              </p>
            </div>
            <p className="text-xs font-semibold flex-none text-text-muted">
              {formatMoney(it.tx.amount, true)}
            </p>
            <button onClick={() => void restore(it.id)} aria-label="Вернуть операцию"
              className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center flex-none">
              <RotateCcw size={15} />
            </button>
            <button onClick={() => void dropFromTrash(it.id)} aria-label="Убрать из корзины насовсем"
              className="w-9 h-9 rounded-xl bg-bg-card2 text-text-muted flex items-center justify-center flex-none">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TransactionsScreen() {
  const { setEditTx } = useApp()
  const { profiles, canSeeAll, scope } = useProfile()
  const [tab, setTab] = useState<Tab>('all')
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [accountFilter, setAccountFilter] = useState<string>('')
  const [profileFilter, setProfileFilter] = useState<string>('')
  const [limit, setLimit] = useState(PAGE)

  const colors = useMemo(() => loadAmountColors(), [])
  const accounts = useAccounts(true)
  const isTrash = tab === 'trash'
  const isAll = tab === 'all' || isTrash

  /** Вкладки периодов — те же, что настроены в аналитике, плюс «Всё время». */
  const tabs = useMemo<{ id: Tab; label: string }[]>(() => [
    { id: 'all', label: 'Всё время' },
    ...loadPeriods()
      .filter(p => p !== 'custom' && p !== 'day')
      .map(p => ({ id: p as Tab, label: PERIOD_OPTIONS.find(o => o.id === p)!.label })),
  ], [])

  /** Любое изменение выборки возвращает ленту в начало: иначе человек остался бы
   *  на сороковой позиции уже другого списка. */
  const reset = useCallback(() => setLimit(PAGE), [])

  const range = useMemo(
    () => getRange(isAll ? 'month' : tab, offset),
    [isAll, tab, offset],
  )

  /**
   * Значения по умолчанию у `useLiveQuery` НЕТ намеренно: с `[]` первый кадр
   * неотличим от пустой базы, и на каждом открытии экрана мелькало
   * «Операций пока нет» с нулями в плитках — при полной истории операций.
   * `undefined` означает «ещё читаем», и это состояние рисуется отдельно.
   */
  const trash = useLiveQuery(() => db.trash.orderBy('deletedAt').reverse().toArray(), [])
  const trashCount = trash?.length ?? 0

  const rawTransactions = useLiveQuery(
    () => (isAll
      ? db.transactions.orderBy('date').reverse().toArray()
      : db.transactions.where('date')
        .between(range.from.toISOString(), range.to.toISOString(), true, true)
        .reverse().sortBy('date')),
    [isAll, range.from.getTime(), range.to.getTime()],
  )
  const loading = rawTransactions === undefined

  // видимость по роли применяется до пользовательских фильтров
  const transactions = useMemo(() => scope(rawTransactions ?? []), [rawTransactions, scope])

  const filtered = useMemo(() => transactions.filter(tx => {
    const q = search.trim().toLowerCase()
    const matchSearch = !q
      || tx.title.toLowerCase().includes(q)
      || categoryName(tx.categoryId).toLowerCase().includes(q)
      || (tx.comment ?? '').toLowerCase().includes(q)
    const matchType = filter === 'all' || tx.type === filter
    const matchAccount = !accountFilter || tx.accountId === accountFilter || tx.toAccountId === accountFilter
    const matchProfile = !profileFilter || tx.profileId === profileFilter
    return matchSearch && matchType && matchAccount && matchProfile
  }), [transactions, search, filter, accountFilter, profileFilter])

  /** Выборка сужена: периодом, поиском или любым из фильтров. */
  const narrowed = !isAll || Boolean(search.trim()) || filter !== 'all'
    || Boolean(accountFilter) || Boolean(profileFilter)

  /** Итоги считаются по ВСЕЙ выборке, а не по дорисованному куску. */
  const t = totals(filtered)
  /**
   * Страница дорисовывается до конца дня: иначе последний день куска показывал
   * итог по половине своих операций — сумма рядом с датой не билась с тем,
   * что в этом дне на самом деле.
   */
  const visible = useMemo(
    () => filtered.slice(0, cutAtDayEnd(filtered, limit)),
    [filtered, limit],
  )
  const hasMore = filtered.length > visible.length

  /**
   * Бесконечная прокрутка. Наблюдаем за «хвостом» списка и дорисовываем ещё
   * страницу, когда он в поле зрения. setState происходит в колбэке наблюдателя,
   * а не в теле эффекта, — лишнего рендера это не создаёт.
   *
   * В зависимостях `visible.length`, а не только `hasMore`: наблюдатель
   * обязан пере-подключаться после каждой дорисовки. IntersectionObserver
   * зовёт колбэк только на СМЕНУ пересечения; если хвост так и остался в зоне
   * видимости, второго вызова не будет — и лента замирала на четвёртой
   * странице (ровно это и наблюдалось вживую). Свежий наблюдатель при
   * подключении сам сообщает текущее состояние, поэтому подгрузка продолжается,
   * пока хвост виден, и останавливается, когда он ушёл вниз или данные кончились.
   */
  const tailRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = tailRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setLimit(n => n + PAGE) },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, visible.length])

  return (
    <div className="flex flex-col gap-4 pb-28">
      <h1 className="text-text-primary text-2xl font-bold">История</h1>

      <ScopePicker />

      {!isTrash && (
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={search} onChange={e => { setSearch(e.target.value); reset() }}
            placeholder="Поиск по названию, категории, комментарию"
            className="w-full bg-bg-card border border-border rounded-2xl pl-10 pr-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
        </div>
      )}

      {/* Подразделы периода по центру, а не прижаты к левому краю */}
      <div className="flex flex-wrap justify-center gap-2">
        {tabs.map(p => (
          <button key={p.id} onClick={() => { setTab(p.id); setOffset(0); reset() }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tab === p.id ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary border border-border'}`}>
            {p.label}
          </button>
        ))}
        {/* Корзина — такая же вкладка: удалённое не прячется в настройках,
            искать его там никто бы не стал */}
        <button onClick={() => { setTab('trash'); reset() }}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-1.5 ${
            isTrash ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary border border-border'}`}>
          <Trash2 size={13} /> Удалённые{trashCount ? ` (${trashCount})` : ''}
        </button>
      </div>

      {/* Навигация по периодам нужна только когда период выбран */}
      {!isAll && (
        <div className="flex items-center justify-between bg-bg-card border border-border rounded-2xl px-2 py-2">
          <button onClick={() => { setOffset(o => o - 1); reset() }} aria-label="Предыдущий период"
            className="w-9 h-9 rounded-xl bg-bg-card2 flex items-center justify-center text-text-secondary">
            <ChevronLeft size={18} />
          </button>
          <p className="text-text-primary text-sm font-semibold">{range.label}</p>
          <button onClick={() => { setOffset(o => Math.min(0, o + 1)); reset() }} disabled={offset >= 0}
            aria-label="Следующий период"
            className="w-9 h-9 rounded-xl bg-bg-card2 flex items-center justify-center text-text-secondary disabled:opacity-30">
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Поиск, фильтры и итоги относятся к истории; в корзине им нечего фильтровать */}
      {!isTrash && (<>
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {([['all', 'Все'], ['expense', '↓ Расходы'], ['income', '↑ Доходы'], ['transfer', '⇄ Переводы']] as const).map(([id, label]) => (
          <button key={id} onClick={() => { setFilter(id); reset() }}
            className={`flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === id ? 'bg-bg-card2 text-text-primary border border-accent' : 'bg-bg-card text-text-muted border border-border'}`}>
            {label}
          </button>
        ))}
        {(accounts?.length ?? 0) > 1 && (
          <select value={accountFilter} onChange={e => { setAccountFilter(e.target.value); reset() }}
            className="flex-none bg-bg-card text-text-muted border border-border rounded-lg text-xs px-2 py-1.5 outline-none">
            <option value="">Все счета</option>
            {accounts?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {canSeeAll && profiles.length > 1 && (
          <select value={profileFilter} onChange={e => { setProfileFilter(e.target.value); reset() }}
            className="flex-none bg-bg-card text-text-muted border border-border rounded-lg text-xs px-2 py-1.5 outline-none">
            <option value="">Все профили</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1 bg-bg-card border border-border rounded-2xl p-3">
          <p className="text-text-muted text-xs">Расходы</p>
          <p className="text-base font-bold mt-0.5" style={{ color: colors.expense }}>
            {loading ? '—' : formatMoney(t.expense, true)}
          </p>
        </div>
        <div className="flex-1 bg-bg-card border border-border rounded-2xl p-3">
          <p className="text-text-muted text-xs">Доходы</p>
          <p className="text-base font-bold mt-0.5" style={{ color: colors.income }}>
            {loading ? '—' : formatMoney(t.income, true)}
          </p>
        </div>
        <div className="flex-1 bg-bg-card border border-border rounded-2xl p-3">
          <p className="text-text-muted text-xs">Итого</p>
          {/* formatSigned, а не formatMoney: у отрицательного итога Intl ставит
              свой дефис, и на одном экране оказывались два разных минуса */}
          <p className="text-base font-bold mt-0.5"
            style={{ color: t.net >= 0 ? colors.income : colors.expense }}>
            {loading ? '—' : formatSigned(t.net, true)}
          </p>
        </div>
      </div>
      </>)}

      {isTrash ? (
        <TrashList items={trash} accounts={accounts ?? []} />
      ) : loading ? (
        <p className="text-text-muted text-xs text-center py-16">Загружаем операции…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-2">🔍</p>
          <p className="text-text-secondary">
            {isAll ? 'Операций пока нет' : 'Нет операций за период'}
          </p>
        </div>
      ) : (
        <>
          {/* Разделители месяцев — там, где выборка длиннее месяца: во «Всём
              времени», в квартале и в году. Без них год превращается в стену
              дней, по которой непонятно, где кончился месяц. */}
          <TxList items={visible} onPick={setEditTx} colors={colors} showEdit
            accounts={accounts ?? []}
            showMonths={isAll || tab === 'quarter' || tab === 'year'} />
          {/* хвост: как только попал в поле зрения — дорисовываем следующую страницу */}
          <div ref={tailRef} className="h-10 flex items-center justify-center">
            {hasMore && <p className="text-text-muted text-xs">Загружаем ещё…</p>}
          </div>
          {/* «Это вся история» — только когда это правда вся история. С поиском,
              фильтром или выбранным периодом конец списка означает «это всё, что
              подошло», а не «больше операций нет»: с включёнными расходами
              подпись обещала всю историю и называла 136 из 142 операций. */}
          {!hasMore && filtered.length > PAGE && (
            <p className="text-text-muted text-xs text-center">
              {narrowed ? 'Это всё по выбранным условиям' : 'Это вся история'}
              {' — '}{filtered.length} {plural(filtered.length, 'операция', 'операции', 'операций')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
