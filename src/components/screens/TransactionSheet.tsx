import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Loader2, Trash2, ArrowRight } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { addTransaction, updateTransaction, deleteTransaction, LedgerError } from '../../db/transactions'
import { selectableCategories } from '../../db/categories'
import { toMinor } from '../../utils/money'
import { isoToLocalInput, localInputToIso, formatMoney } from '../../utils/format'
import { useApp } from '../../store/AppContext'
import { Sheet, Field, inputCls, primaryBtn } from '../ui/Sheet'
import type { Transaction, TransactionType } from '../../types'

const NUMPAD = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '⌫', '0', ',']

function display(raw: string): string {
  const [int, dec] = raw.split(',')
  const i = new Intl.NumberFormat('ru-RU').format(Number(int || '0'))
  return dec !== undefined ? `${i},${dec}` : i
}

interface Props {
  open: boolean
  tx: Transaction | null
  onClose: () => void
}

export function TransactionSheet({ open, tx, onClose }: Props) {
  const { showToast } = useApp()
  const isEdit = Boolean(tx)

  const accounts = useLiveQuery(
    () => db.accounts.orderBy('sortOrder').toArray().then(l => l.filter(a => !a.isArchived)),
    [],
  )

  const [type, setType] = useState<TransactionType>('expense')
  const [amountStr, setAmountStr] = useState('0')
  const [categoryId, setCategoryId] = useState('groceries')
  const [accountId, setAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [title, setTitle] = useState('')
  const [comment, setComment] = useState('')
  const [date, setDate] = useState('')
  const [step, setStep] = useState<'amount' | 'details'>('amount')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // инициализация при открытии
  useEffect(() => {
    if (!open) return
    setError(null); setBusy(false)
    if (tx) {
      setType(tx.type)
      setAmountStr(String(tx.amount / 100).replace('.', ','))
      setCategoryId(tx.categoryId)
      setAccountId(tx.accountId)
      setToAccountId(tx.toAccountId ?? '')
      setTitle(tx.title)
      setComment(tx.comment ?? '')
      setDate(isoToLocalInput(tx.date))
      setStep('details')
    } else {
      setType('expense'); setAmountStr('0'); setCategoryId('groceries')
      setTitle(''); setComment(''); setToAccountId('')
      setDate(isoToLocalInput(new Date().toISOString()))
      setStep('amount')
    }
  }, [open, tx])

  // счёт по умолчанию — первый реальный, а не захардкоженный 'vtb', которого ни у кого нет
  useEffect(() => {
    if (!open || !accounts?.length) return
    setAccountId(prev => (prev && accounts.some(a => a.id === prev) ? prev : accounts[0].id))
  }, [open, accounts])

  const categories = useMemo(
    () => (type === 'transfer' ? [] : selectableCategories(type)),
    [type],
  )

  useEffect(() => {
    if (type === 'transfer') return
    if (!categories.some(c => c.id === categoryId)) setCategoryId(categories[0]?.id ?? 'other_exp')
  }, [type, categories, categoryId])

  const amount = toMinor(amountStr)

  // Все ветки работают через функциональное обновление: иначе две быстрые
  // нажатия подряд видели бы одно и то же устаревшее значение из замыкания.
  function numpad(key: string) {
    setError(null)
    setAmountStr(prev => {
      if (key === '⌫') return prev.length > 1 ? prev.slice(0, -1) : '0'
      if (key === ',') return prev.includes(',') ? prev : prev + ','
      if (prev === '0') return key
      const [, dec] = prev.split(',')
      if (dec !== undefined && dec.length >= 2) return prev
      if (prev.replace(',', '').length >= 12) return prev
      return prev + key
    })
  }

  async function save() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const input = {
        type, amount,
        categoryId,
        accountId,
        toAccountId: type === 'transfer' ? toAccountId : null,
        title: title.trim(),
        comment: comment.trim() || null,
        date: date ? localInputToIso(date) : undefined,
      }
      if (tx) await updateTransaction(tx.id, input)
      else await addTransaction(input)
      showToast(tx ? 'Операция обновлена' : 'Операция добавлена')
      onClose()
    } catch (e) {
      console.error('[tx save]', e)
      setError(e instanceof LedgerError ? e.message : 'Не удалось сохранить операцию')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!tx || busy) return
    setBusy(true)
    try {
      await deleteTransaction(tx.id)
      showToast('Операция удалена, баланс возвращён')
      onClose()
    } catch (e) {
      console.error('[tx delete]', e)
      setError('Не удалось удалить')
    } finally {
      setBusy(false)
    }
  }

  const accentCls = type === 'income' ? 'text-accent-green' : type === 'expense' ? 'text-accent-red' : 'text-text-primary'
  const noAccounts = accounts && accounts.length === 0
  const needsSecondAccount = type === 'transfer' && (accounts?.length ?? 0) < 2

  return (
    <Sheet open={open} title={isEdit ? 'Операция' : 'Новая операция'} onClose={onClose}>
      <div className="flex bg-bg-card2 rounded-xl p-1 mb-4">
        {(['expense', 'income', 'transfer'] as TransactionType[]).map(t => (
          <button key={t} onClick={() => { setType(t); setError(null) }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              type === t ? 'bg-accent text-white' : 'text-text-secondary'}`}>
            {t === 'expense' ? 'Расход' : t === 'income' ? 'Доход' : 'Перевод'}
          </button>
        ))}
      </div>

      {noAccounts && (
        <p className="text-accent-yellow text-sm text-center py-6">
          Сначала добавьте счёт на вкладке «Счета».
        </p>
      )}

      {!noAccounts && step === 'amount' && (
        <>
          <div className="flex flex-col items-center py-4">
            <p className="text-text-muted text-sm mb-1">Сумма</p>
            <p className={`text-5xl font-bold tracking-tight ${accentCls}`}>
              {display(amountStr)} <span className="text-3xl">₽</span>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {NUMPAD.map(k => (
              <button key={k} onClick={() => numpad(k)}
                className={`h-14 rounded-2xl text-xl font-bold active:scale-95 transition-transform flex items-center justify-center ${
                  k === '⌫' ? 'bg-accent-red/20 text-accent-red' : 'bg-bg-card2 text-text-primary'}`}>
                {k}
              </button>
            ))}
          </div>
          <button disabled={amount <= 0} onClick={() => setStep('details')}
            className={`${primaryBtn} h-14 flex items-center justify-center gap-2`}>
            Далее <ChevronRight size={18} />
          </button>
        </>
      )}

      {!noAccounts && step === 'details' && (
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <button onClick={() => setStep('amount')} className={`text-3xl font-bold ${accentCls}`}>
              {type === 'income' ? '+' : type === 'expense' ? '−' : ''}{formatMoney(amount)}
            </button>
            <p className="text-accent text-xs mt-1">нажмите, чтобы изменить сумму</p>
          </div>

          {type !== 'transfer' && (
            <Field label="Категория">
              <div className="flex flex-wrap gap-2">
                {categories.map(c => (
                  <button key={c.id} onClick={() => setCategoryId(c.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                      categoryId === c.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                    <span>{c.icon}</span> {c.name}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <Field label={type === 'transfer' ? 'Откуда' : 'Счёт'}>
            <div className="flex flex-wrap gap-2">
              {accounts?.map(a => (
                <button key={a.id} onClick={() => setAccountId(a.id)}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    accountId === a.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                  {a.name}
                </button>
              ))}
            </div>
          </Field>

          {type === 'transfer' && (
            <Field label="Куда">
              <div className="flex flex-wrap gap-2">
                {accounts?.filter(a => a.id !== accountId).map(a => (
                  <button key={a.id} onClick={() => setToAccountId(a.id)}
                    className={`flex items-center gap-1 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      toAccountId === a.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                    <ArrowRight size={12} /> {a.name}
                  </button>
                ))}
              </div>
              {needsSecondAccount && (
                <p className="text-accent-yellow text-xs mt-2">
                  Для перевода нужно минимум два счёта.
                </p>
              )}
            </Field>
          )}

          <Field label="Название">
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder={type === 'transfer' ? 'Перевод между счетами' : 'Например, Пятёрочка'}
              className={inputCls} />
          </Field>

          <Field label="Дата и время">
            <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)}
              className={inputCls} />
          </Field>

          <Field label="Комментарий">
            <input value={comment} onChange={e => setComment(e.target.value)}
              placeholder="необязательно" className={inputCls} />
          </Field>

          {error && <p className="text-accent-red text-xs">{error}</p>}

          <button onClick={save} disabled={busy || amount <= 0 || (type === 'transfer' && !toAccountId)}
            className={`${primaryBtn} h-14 flex items-center justify-center gap-2`}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {isEdit ? 'Сохранить изменения' : 'Сохранить'}
          </button>

          {isEdit && (
            <button onClick={remove} disabled={busy}
              className="w-full h-11 rounded-xl bg-accent-red/10 text-accent-red text-sm font-semibold flex items-center justify-center gap-2">
              <Trash2 size={15} /> Удалить операцию
            </button>
          )}
        </div>
      )}
    </Sheet>
  )
}
