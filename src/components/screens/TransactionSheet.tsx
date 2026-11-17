import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Loader2, Trash2, ArrowRight, Keyboard } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import {
  addTransaction, updateTransaction, deleteTransaction, restoreTransaction, LedgerError,
} from '../../db/transactions'
import { selectableCategories } from '../../db/categories'
import { toMinor, groupMoney, minorToInput } from '../../utils/money'
import { isoToLocalInput, localInputToIso, formatMoney } from '../../utils/format'
import { useApp } from '../../store/AppContext'
import { useProfile } from '../../store/ProfileContext'
import { Sheet, Field, inputCls, primaryBtn } from '../ui/Sheet'
import { MoneyInput } from '../ui/MoneyInput'
import { CategoryIcon } from '../ui/CategoryIcon'
import {
  amountColor, loadAmountColors, loadKeypadPrefs, saveKeypadPrefs,
  type KeypadPrefs, type PadLayout,
} from '../../utils/uiPrefs'
import type { Transaction, TransactionType } from '../../types'

/**
 * Раскладки экранного блока цифр.
 * `phone` — как на телефоне, 1-2-3 сверху: это и есть привычный порядок,
 * он стоит по умолчанию. `calculator` — как на калькуляторе, 7-8-9 сверху
 * (прежнее поведение, осталось переключателем).
 */
const PAD_KEYS: Record<PadLayout, string[]> = {
  phone:      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', ','],
  calculator: ['7', '8', '9', '4', '5', '6', '1', '2', '3', '⌫', '0', ','],
}

interface Props {
  /** null — новая операция */
  tx: Transaction | null
  onClose: () => void
}

/**
 * Монтируется только когда открыт (в App.tsx с `key`), поэтому начальное
 * состояние задаётся прямо в useState — как в ProfileSheet. Прежняя версия
 * висела в дереве всегда и переносила пропсы в стейт эффектом: лишний кадр
 * со старыми данными и каскад перерисовок.
 */
export function TransactionSheet({ tx, onClose }: Props) {
  const { showToast } = useApp()
  const { profiles, canSeeAll } = useProfile()
  const isEdit = Boolean(tx)

  const accounts = useLiveQuery(
    () => db.accounts.orderBy('sortOrder').toArray().then(l => l.filter(a => !a.isArchived)),
    [],
  )

  const [type, setType] = useState<TransactionType>(tx?.type ?? 'expense')
  const [amountStr, setAmountStr] = useState(tx ? minorToInput(tx.amount) : '0')
  const [pickedCategoryId, setCategoryId] = useState(tx?.categoryId ?? 'groceries')
  const [pickedAccountId, setAccountId] = useState(tx?.accountId ?? '')
  const [toAccountId, setToAccountId] = useState(tx?.toAccountId ?? '')
  const [title, setTitle] = useState(tx?.title ?? '')
  const [comment, setComment] = useState(tx?.comment ?? '')
  const [date, setDate] = useState(() => isoToLocalInput(tx?.date ?? new Date().toISOString()))
  const [step, setStep] = useState<'amount' | 'details'>(tx ? 'details' : 'amount')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keypad, setKeypad] = useState<KeypadPrefs>(loadKeypadPrefs)
  const colors = useMemo(() => loadAmountColors(), [])
  const [profileId, setProfileId] = useState<string | null>(tx?.profileId ?? null)

  function updateKeypad(next: KeypadPrefs) {
    setKeypad(next)
    saveKeypadPrefs(next)        // выбор запоминается; сбрасывается при выходе из аккаунта
  }

  const categories = useMemo(
    () => (type === 'transfer' ? [] : selectableCategories(type)),
    [type],
  )

  /**
   * Счёт и категория ВЫЧИСЛЯЮТСЯ, а не правятся эффектом.
   * Счёт по умолчанию — первый реальный, а не захардкоженный 'vtb', которого
   * ни у кого нет; категория подстраивается под тип операции. Раньше оба
   * значения «догонялись» эффектами, и первый кадр показывал неверный выбор.
   */
  const accountId = pickedAccountId && accounts?.some(a => a.id === pickedAccountId)
    ? pickedAccountId
    : accounts?.[0]?.id ?? ''

  const categoryId = type === 'transfer' || categories.some(c => c.id === pickedCategoryId)
    ? pickedCategoryId
    : categories[0]?.id ?? 'other_exp'

  const amount = toMinor(amountStr)

  /**
   * Физическая клавиатура работает всегда, независимо от режима — на ПК
   * экранный блок можно было нажимать только мышью. Ввод с клавиатуры
   * дублирует нажатия по экранному блоку, значения не расходятся.
   */
  useEffect(() => {
    if (step !== 'amount') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      // в режиме обычной клавиатуры поле само обрабатывает ввод
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (/^[0-9]$/.test(e.key)) { numpad(e.key); e.preventDefault(); return }
      if (e.key === ',' || e.key === '.') { numpad(','); e.preventDefault(); return }
      if (e.key === 'Backspace') { numpad('⌫'); e.preventDefault(); return }
      if (e.key === 'Enter' && toMinor(amountStr) > 0) { setStep('details'); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, amountStr])

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
        // при создании не передаём: ядро само подставит активный профиль
        profileId: isEdit ? profileId : undefined,
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
    /* Спрашиваем: кнопка стоит сразу под «Сохранить изменения», а удаление
       снимает проводки и двигает баланс. Теперь оно обратимо — операция
       уходит в корзину, — но вопрос оставлен: вернуть можно, а заметить
       случайное удаление всё равно сначала надо. */
    if (!confirm(`Удалить операцию на ${formatMoney(tx.amount)}? Вернуть её можно в «Истории» → «Удалённые».`)) return
    setBusy(true)
    try {
      const id = tx.id
      await deleteTransaction(id)
      showToast('Операция удалена', {
        label: 'Вернуть',
        run: () => {
          restoreTransaction(id)
            .then(() => showToast('Операция возвращена'))
            .catch(e => showToast(e instanceof LedgerError ? e.message : 'Не удалось вернуть операцию'))
        },
      })
      onClose()
    } catch (e) {
      console.error('[tx delete]', e)
      setError('Не удалось удалить')
    } finally {
      setBusy(false)
    }
  }

  /** Цвет суммы — из настроек, как в списках операций: иначе выбранный цвет
   *  виден в истории, а на вводе сумма всё равно красная. */
  const accentColor = type === 'transfer' ? undefined : amountColor(type, colors)
  const noAccounts = accounts && accounts.length === 0
  const needsSecondAccount = type === 'transfer' && (accounts?.length ?? 0) < 2

  return (
    <Sheet open title={isEdit ? 'Операция' : 'Новая операция'} onClose={onClose}>
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
            <p className="text-5xl font-bold tracking-tight text-text-primary"
              style={accentColor ? { color: accentColor } : undefined}>
              {groupMoney(amountStr)} <span className="text-3xl">₽</span>
            </p>
          </div>

          {/* Переключатель способа ввода. Выбор запоминается на устройстве и
              сбрасывается на стандартный после повторной авторизации. */}
          <div className="flex items-center justify-center gap-1.5 mb-3">
            <button onClick={() => updateKeypad({ ...keypad, mode: keypad.mode === 'pad' ? 'keyboard' : 'pad' })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-card2 text-text-secondary text-[11px] font-semibold">
              <Keyboard size={12} />
              {keypad.mode === 'pad' ? 'Своя клавиатура' : 'Блок цифр'}
            </button>
            {keypad.mode === 'pad' && (
              <button onClick={() => updateKeypad({ ...keypad, layout: keypad.layout === 'phone' ? 'calculator' : 'phone' })}
                className="px-3 py-1.5 rounded-lg bg-bg-card2 text-text-secondary text-[11px] font-semibold">
                {keypad.layout === 'phone' ? '1-2-3' : '7-8-9'}
              </button>
            )}
          </div>

          {keypad.mode === 'pad' ? (
            <div className="grid grid-cols-3 gap-2 mb-4">
              {PAD_KEYS[keypad.layout].map(k => (
                <button key={k} onClick={() => numpad(k)}
                  className={`h-14 rounded-2xl text-xl font-bold active:scale-95 transition-transform flex items-center justify-center ${
                    k === '⌫' ? 'bg-accent-red/20 text-accent-red' : 'bg-bg-card2 text-text-primary'}`}>
                  {k}
                </button>
              ))}
            </div>
          ) : (
            <div className="mb-4">
              <MoneyInput value={amountStr} onChange={setAmountStr} autoFocus
                aria-label="Сумма операции"
                className={`${inputCls} text-center text-2xl font-bold`} />
              <p className="text-text-muted text-[11px] text-center mt-2">
                Ввод с клавиатуры устройства. Enter — дальше.
              </p>
            </div>
          )}
          <button disabled={amount <= 0} onClick={() => setStep('details')}
            className={`${primaryBtn} h-14 flex items-center justify-center gap-2`}>
            Далее <ChevronRight size={18} />
          </button>
        </>
      )}

      {!noAccounts && step === 'details' && (
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <button onClick={() => setStep('amount')} className="text-3xl font-bold text-text-primary"
              style={accentColor ? { color: accentColor } : undefined}>
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
                    <CategoryIcon id={c.id} size={16} /> {c.name}
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

          {/* Сменить владельца может только главная роль: ограниченная иначе
              переписала бы чужую операцию на себя или спрятала бы свою. */}
          {isEdit && canSeeAll && profiles.length > 1 && (
            <Field label="Чья операция">
              <div className="flex flex-wrap gap-2">
                {profiles.map(p => (
                  <button key={p.id} onClick={() => setProfileId(p.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                      profileId === p.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                    {p.emoji} {p.name}
                  </button>
                ))}
              </div>
              <p className="text-text-muted text-[11px] mt-1.5">
                Операция переедет в статистику выбранного профиля.
              </p>
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
