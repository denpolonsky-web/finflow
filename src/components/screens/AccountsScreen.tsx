import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Scale, Archive } from 'lucide-react'
import {
  ACCOUNT_KINDS, BANK_PRESETS, bankPreset, createAccount, updateAccount,
  removeAccount, availableCredit, depositInfo, kindLabel,
} from '../../db/accounts'
import { loadWidgetPrefs } from '../../utils/uiPrefs'
import { reconcileAccount } from '../../db/transactions'
import { formatMoney, isoDateOnly, dateInputToIso, plural } from '../../utils/format'
import { toMinor, minorToInput } from '../../utils/money'
import { useAccounts, useBalances, liquidTotal, netWorth } from '../../hooks/useBalances'
import { useApp } from '../../store/AppContext'
import { Sheet, Field, inputCls, primaryBtn } from '../ui/Sheet'
import { MoneyInput } from '../ui/MoneyInput'
import type { Account, AccountKind } from '../../types'

type FormState = {
  kind: AccountKind; bank: string; name: string; balance: string; lastFour: string
  creditLimit: string; interestRate: string; capitalization: Account['capitalization']; maturityDate: string
  isReplenishable: 0 | 1
}

const emptyForm = (): FormState => ({
  kind: 'debit', bank: 'other', name: '', balance: '', lastFour: '',
  creditLimit: '', interestRate: '', capitalization: 'monthly', maturityDate: '',
  isReplenishable: 0,
})

export function AccountsScreen() {
  const { showToast } = useApp()
  const accounts = useAccounts(true)
  const balances = useBalances()

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [reconcile, setReconcile] = useState<Account | null>(null)
  const [statedStr, setStatedStr] = useState('')
  const [recordGap, setRecordGap] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const widgets = useMemo(() => loadWidgetPrefs(), [])

  /** `undefined` — список ещё читается; с пустым массивом первый кадр
   *  неотличим от кабинета без счетов и показывал «Счетов пока нет». */
  const loading = accounts === undefined
  const all = accounts ?? []
  const visible = all.filter(a => (showArchived ? true : !a.isArchived))
  const net = netWorth(all.filter(a => !a.isArchived), balances)
  const liquid = liquidTotal(all.filter(a => !a.isArchived), balances)

  function openCreate() {
    setEditing(null); setForm(emptyForm()); setError(null); setShowForm(true)
  }

  function openEdit(a: Account) {
    setEditing(a)
    setForm({
      kind: a.kind, bank: a.bank, name: a.name,
      balance: '', lastFour: a.lastFour ?? '',
      creditLimit: minorToInput(a.creditLimit),
      interestRate: a.interestRate != null ? String(a.interestRate) : '',
      capitalization: a.capitalization ?? 'monthly',
      maturityDate: isoDateOnly(a.maturityDate),
      isReplenishable: a.isReplenishable === 1 ? 1 : 0,
    })
    setError(null); setShowForm(true)
  }

  async function save() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const patch = {
        kind: form.kind,
        bank: form.bank,
        name: form.name.trim() || bankPreset(form.bank).name,
        lastFour: form.lastFour.slice(-4) || undefined,
        color: bankPreset(form.bank).color,
        creditLimit: form.creditLimit ? toMinor(form.creditLimit) : undefined,
        interestRate: form.interestRate ? Number(form.interestRate.replace(',', '.')) : undefined,
        capitalization: form.kind === 'deposit' ? form.capitalization : undefined,
        maturityDate: dateInputToIso(form.maturityDate) ?? undefined,
        isReplenishable: form.kind === 'deposit' ? form.isReplenishable : undefined,
      }
      if (editing) {
        await updateAccount(editing.id, patch)
        showToast('Счёт обновлён')
      } else {
        await createAccount({ ...patch, openingBalance: toMinor(form.balance || '0') })
        showToast('Счёт добавлен')
      }
      setShowForm(false)
    } catch (e) {
      console.error('[account save]', e)
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  async function remove(a: Account) {
    const res = await removeAccount(a.id)
    showToast(res === 'archived'
      ? 'На счёте есть операции — он перенесён в архив'
      : 'Счёт удалён')
  }

  async function applyReconcile() {
    if (!reconcile) return
    setBusy(true)
    try {
      const derived = balances.get(reconcile.id) ?? 0
      await reconcileAccount(reconcile.id, toMinor(statedStr), derived, { record: recordGap })
      showToast(recordGap ? 'Расхождение записано операцией' : 'Сверка сохранена')
      setReconcile(null); setStatedStr('')
    } finally {
      setBusy(false)
    }
  }

  const gap = reconcile ? toMinor(statedStr) - (balances.get(reconcile.id) ?? 0) : 0

  return (
    <div className="flex flex-col gap-4 pb-28">
      <div className="flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-bold">Счета</h1>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-xl active:scale-95 transition-transform">
          <Plus size={16} /> Добавить
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-bg-card border border-border rounded-2xl p-4">
          <p className="text-text-muted text-xs">Всего</p>
          <p className="text-text-primary text-xl font-bold mt-1">{formatMoney(net)}</p>
        </div>
        <div className="bg-bg-card border border-border rounded-2xl p-4">
          <p className="text-text-muted text-xs">Доступно сейчас</p>
          <p className="text-accent-green text-xl font-bold mt-1">{formatMoney(liquid)}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-text-muted text-xs text-center py-14">Загружаем…</p>
      ) : visible.length === 0 ? (
        <div className="text-center py-14">
          <p className="text-4xl mb-2">💳</p>
          <p className="text-text-secondary text-sm">Счетов пока нет</p>
          <button onClick={openCreate} className="text-accent text-sm mt-2">Добавить первый →</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map(a => {
            const bal = balances.get(a.id) ?? 0
            const avail = availableCredit(a, bal)
            const dep = depositInfo(a, bal)
            return (
              <div key={a.id}
                className={`relative rounded-2xl p-5 overflow-hidden bg-gradient-to-br ${bankPreset(a.bank).gradient} ${a.isArchived ? 'opacity-50' : ''}`}>
                <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-white/5" />
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <p className="text-white/70 text-xs font-medium truncate">{a.name}</p>
                    <p className="text-white/40 text-[11px] mt-0.5">
                      {kindLabel(a.kind)}{a.lastFour ? ` · •••• ${a.lastFour}` : ''}
                      {a.isArchived ? ' · в архиве' : ''}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-none">
                    <button onClick={() => { setReconcile(a); setStatedStr(minorToInput(bal)) }}
                      aria-label="Сверить баланс"
                      className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white/70">
                      <Scale size={13} />
                    </button>
                    <button onClick={() => openEdit(a)} aria-label="Изменить"
                      className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white/70">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => remove(a)} aria-label="Удалить"
                      className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white/70">
                      {a.isArchived ? <Trash2 size={13} /> : <Archive size={13} />}
                    </button>
                  </div>
                </div>
                <p className={`text-2xl font-bold ${bal < 0 ? 'text-red-200' : 'text-white'}`}>{formatMoney(bal)}</p>

                {avail != null && (
                  <p className="text-white/50 text-[11px] mt-1">
                    Доступно по лимиту: {formatMoney(avail)}
                  </p>
                )}

                {dep && (
                  <div className="mt-2 flex flex-col gap-1">
                    {dep.matured ? (
                      <p className="text-amber-200 text-[11px] font-medium">
                        Срок вклада истёк — заберите деньги и закройте счёт
                      </p>
                    ) : (
                      <>
                        {dep.accrued != null && dep.accrued > 0 && (
                          <p className="text-white/70 text-[11px]">
                            Уже начислено: {formatMoney(dep.accrued, true)}
                          </p>
                        )}
                        {widgets.depositForecast && dep.projected != null && dep.interest != null && (
                          <p className="text-white/50 text-[11px]">
                            Через {dep.daysLeft} {plural(dep.daysLeft, 'день', 'дня', 'дней')} →{' '}
                            {formatMoney(dep.projected)} (+{formatMoney(dep.interest, true)})
                          </p>
                        )}
                      </>
                    )}
                    <p className="text-white/40 text-[11px]">
                      {dep.replenishable ? 'Можно пополнять' : 'Без пополнения'}
                      {a.interestRate ? ` · ${a.interestRate}% годовых` : ''}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {all.some(a => a.isArchived) && (
        <button onClick={() => setShowArchived(s => !s)} className="text-text-muted text-xs py-2">
          {showArchived ? 'Скрыть архив' : 'Показать архив'}
        </button>
      )}

      {/* форма счёта */}
      <Sheet open={showForm} title={editing ? 'Редактировать счёт' : 'Новый счёт'} onClose={() => setShowForm(false)}>
        <div className="flex flex-col gap-4">
          <Field label="Тип счёта">
            <div className="grid grid-cols-3 gap-2">
              {ACCOUNT_KINDS.map(k => (
                <button key={k.id} onClick={() => setForm(f => ({ ...f, kind: k.id }))}
                  className={`py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    form.kind === k.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                  {k.icon} {k.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Банк">
            <div className="grid grid-cols-3 gap-2">
              {BANK_PRESETS.map(p => (
                <button key={p.id} onClick={() => setForm(f => ({ ...f, bank: p.id, name: f.name || p.name }))}
                  className={`py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    form.bank === p.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                  {p.name}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Название">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
          </Field>

          {!editing && (
            <Field label="Текущий остаток, ₽">
              <MoneyInput value={form.balance}
                onChange={v => setForm(f => ({ ...f, balance: v }))} className={inputCls} />
            </Field>
          )}
          {editing && (
            <p className="text-text-muted text-[11px] -mt-1">
              Баланс не редактируется напрямую: он считается из операций.
              Чтобы подогнать его под банк, используйте сверку (иконка весов).
            </p>
          )}

          <Field label="Последние 4 цифры">
            <input inputMode="numeric" maxLength={4} value={form.lastFour}
              onChange={e => setForm(f => ({ ...f, lastFour: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
              className={`${inputCls} tracking-widest`} />
          </Field>

          {form.kind === 'credit' && (
            <Field label="Кредитный лимит, ₽">
              <MoneyInput value={form.creditLimit}
                onChange={v => setForm(f => ({ ...f, creditLimit: v }))} className={inputCls} />
            </Field>
          )}

          {form.kind === 'deposit' && (
            <>
              <Field label="Ставка, % годовых">
                <input inputMode="decimal" value={form.interestRate}
                  onChange={e => setForm(f => ({ ...f, interestRate: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Капитализация">
                <div className="grid grid-cols-4 gap-2">
                  {([['none', 'Нет'], ['monthly', 'Мес.'], ['quarterly', 'Кварт.'], ['atEnd', 'В конце']] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setForm(f => ({ ...f, capitalization: id }))}
                      className={`py-2 rounded-xl text-xs font-semibold ${
                        form.capitalization === id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Дата окончания">
                <input type="date" value={form.maturityDate}
                  onChange={e => setForm(f => ({ ...f, maturityDate: e.target.value }))} className={inputCls} />
              </Field>
              {/* поле было в схеме, но нигде не задавалось */}
              <label className="flex items-start gap-3 bg-bg-card2 rounded-xl p-3 cursor-pointer">
                <input type="checkbox" checked={form.isReplenishable === 1}
                  onChange={e => setForm(f => ({ ...f, isReplenishable: e.target.checked ? 1 : 0 }))}
                  className="mt-0.5 accent-[#6C63FF]" />
                <span className="text-text-secondary text-xs">
                  Вклад можно пополнять. Влияет только на подпись на карточке —
                  переводы на счёт приложение не ограничивает.
                </span>
              </label>
            </>
          )}

          {error && <p className="text-accent-red text-xs">{error}</p>}
          <button onClick={save} disabled={busy} className={primaryBtn}>
            {editing ? 'Сохранить' : 'Добавить счёт'}
          </button>
        </div>
      </Sheet>

      {/* сверка */}
      <Sheet open={Boolean(reconcile)} title="Сверка с банком"
        subtitle={reconcile?.name} onClose={() => setReconcile(null)}>
        <div className="flex flex-col gap-4">
          <div className="bg-bg-card2 rounded-2xl p-4 flex justify-between">
            <div>
              <p className="text-text-muted text-xs">В приложении</p>
              <p className="text-text-primary font-bold mt-0.5">
                {formatMoney(reconcile ? balances.get(reconcile.id) ?? 0 : 0)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-text-muted text-xs">Разница</p>
              <p className={`font-bold mt-0.5 ${gap === 0 ? 'text-text-secondary' : gap > 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {gap > 0 ? '+' : ''}{formatMoney(gap)}
              </p>
            </div>
          </div>

          <Field label="Баланс в банке, ₽">
            <MoneyInput value={statedStr} autoFocus
              onChange={setStatedStr} className={inputCls} />
          </Field>

          <label className="flex items-start gap-3 bg-bg-card2 rounded-xl p-3 cursor-pointer">
            <input type="checkbox" checked={recordGap} onChange={e => setRecordGap(e.target.checked)}
              className="mt-0.5 accent-[#6C63FF]" />
            <span className="text-text-secondary text-xs">
              Записать разницу операцией-корректировкой. Она не попадёт в статистику расходов,
              но баланс сойдётся и останется след в истории.
            </span>
          </label>

          <button onClick={applyReconcile} disabled={busy || !statedStr} className={primaryBtn}>
            Сохранить сверку
          </button>
        </div>
      </Sheet>
    </div>
  )
}
