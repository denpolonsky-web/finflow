import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, X, Link2 } from 'lucide-react'
import { db } from '../../db'
import { createGoal, updateGoal, archiveGoal, contributeToGoal, buildPlan } from '../../db/goals'
import { formatMoney, plural } from '../../utils/format'
import { toMinor } from '../../utils/money'
import { monthlyBurn } from '../../utils/analytics'
import { useAccounts, useBalances } from '../../hooks/useBalances'
import { useApp } from '../../store/AppContext'
import { Sheet, Field, inputCls, primaryBtn } from '../ui/Sheet'
import type { Goal, GoalKind } from '../../types'

const ICONS = ['🎯', '🎮', '✈️', '🏠', '🚗', '📱', '💻', '🎓', '💍', '🏋️', '🌍', '🎸', '📷', '⌚', '🛋️', '🛟']

const STATUS: Record<string, { label: string; cls: string }> = {
  'done':        { label: 'Цель достигнута', cls: 'text-accent-green' },
  'on-track':    { label: 'В графике', cls: 'text-accent-green' },
  'behind':      { label: 'Отстаёт от плана', cls: 'text-accent-yellow' },
  'no-progress': { label: 'Нет движения', cls: 'text-text-muted' },
  'no-deadline': { label: 'Без срока', cls: 'text-text-muted' },
}

export function GoalsScreen() {
  const { showToast } = useApp()
  const accounts = useAccounts()
  const balances = useBalances()
  const goals = useLiveQuery(() => db.goals.toArray().then(l => l.filter(g => !g.isArchived)), [], [])
  const allTx = useLiveQuery(() => db.transactions.toArray(), [], [])

  const [showCreate, setShowCreate] = useState(false)
  const [topup, setTopup] = useState<Goal | null>(null)
  const [topupAmt, setTopupAmt] = useState('')
  const [topupFrom, setTopupFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    title: '', kind: 'save' as GoalKind, target: '', icon: '🎯',
    deadline: '', fundingAccountId: '', manual: '', cushionMonths: '6',
  })

  const burn = useMemo(() => monthlyBurn(allTx, 3), [allTx])

  const progressOf = (g: Goal) =>
    g.fundingAccountId ? (balances.get(g.fundingAccountId) ?? 0) : g.manualAmount

  async function create() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const target = form.kind === 'cushion'
        ? burn * Number(form.cushionMonths || '6')
        : toMinor(form.target)
      if (target <= 0) { setError('Укажите целевую сумму'); return }
      await createGoal({
        title: form.title.trim(),
        icon: form.icon,
        kind: form.kind,
        targetAmount: target,
        fundingAccountId: form.fundingAccountId || null,
        manualAmount: form.fundingAccountId ? 0 : toMinor(form.manual || '0'),
        cushionMonths: form.kind === 'cushion' ? Number(form.cushionMonths) : undefined,
        deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
      })
      setForm({ title: '', kind: 'save', target: '', icon: '🎯', deadline: '', fundingAccountId: '', manual: '', cushionMonths: '6' })
      setShowCreate(false)
      showToast('Цель создана')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать цель')
    } finally {
      setBusy(false)
    }
  }

  async function doTopup() {
    if (!topup || busy) return
    const amt = toMinor(topupAmt)
    if (amt <= 0) return
    setBusy(true)
    try {
      await contributeToGoal(topup, amt, topupFrom || undefined)
      showToast(topup.fundingAccountId && topupFrom
        ? 'Перевод выполнен, деньги на целевом счёте'
        : 'Цель пополнена')
      setTopup(null); setTopupAmt(''); setTopupFrom('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось пополнить')
    } finally {
      setBusy(false)
    }
  }

  const totalSaved = goals.reduce((s, g) => s + progressOf(g), 0)
  const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0)

  return (
    <div className="flex flex-col gap-4 pb-28">
      <div className="flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-bold">Цели</h1>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-xl active:scale-95 transition-transform">
          <Plus size={16} /> Новая
        </button>
      </div>

      {goals.length > 0 && (
        <div className="bg-bg-card border border-border rounded-2xl p-4 flex gap-4">
          <div className="flex-1">
            <p className="text-text-muted text-xs">Накоплено</p>
            <p className="text-accent-green text-lg font-bold mt-0.5">{formatMoney(totalSaved, true)}</p>
          </div>
          <div className="w-px bg-border" />
          <div className="flex-1">
            <p className="text-text-muted text-xs">Целей</p>
            <p className="text-text-primary text-lg font-bold mt-0.5">{goals.length}</p>
          </div>
          <div className="w-px bg-border" />
          <div className="flex-1">
            <p className="text-text-muted text-xs">Осталось</p>
            <p className="text-accent-yellow text-lg font-bold mt-0.5">
              {formatMoney(Math.max(0, totalTarget - totalSaved), true)}
            </p>
          </div>
        </div>
      )}

      {goals.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🎯</p>
          <p className="text-text-secondary text-base font-medium">Нет активных целей</p>
          <p className="text-text-muted text-sm mt-1">Создайте первую цель</p>
        </div>
      ) : goals.map(g => {
        const plan = buildPlan(g, progressOf(g))
        const st = STATUS[plan.status]
        const acc = accounts?.find(a => a.id === g.fundingAccountId)
        return (
          <div key={g.id} className="bg-bg-card border border-border rounded-2xl p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-3xl flex-none">{g.icon}</span>
                <div className="min-w-0">
                  <p className="text-text-primary font-bold text-base truncate">{g.title}</p>
                  <p className={`text-xs mt-0.5 ${st.cls}`}>
                    {st.label}
                    {plan.daysLeft != null && plan.daysLeft > 0 && ` · ${plan.daysLeft} ${plural(plan.daysLeft, 'день', 'дня', 'дней')}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-none">
                <span className={`text-sm font-bold ${plan.pct >= 100 ? 'text-accent-green' : 'text-text-secondary'}`}>
                  {plan.pct}%
                </span>
                <button onClick={() => archiveGoal(g.id)} aria-label="В архив"
                  className="text-text-muted hover:text-accent-red transition-colors">
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="h-2 rounded-full bg-bg-card2 overflow-hidden mb-2">
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-indigo-400 transition-all duration-500"
                style={{ width: `${plan.pct}%` }} />
            </div>

            <div className="flex justify-between text-xs mb-3">
              <span className="text-accent font-semibold">{formatMoney(plan.current, true)}</span>
              <span className="text-text-muted">{formatMoney(plan.target, true)}</span>
            </div>

            {acc && (
              <p className="text-text-muted text-[11px] mb-2 flex items-center gap-1">
                <Link2 size={11} /> Считается по счёту «{acc.name}»
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-bg-card2 rounded-xl p-2.5">
                <p className="text-text-muted text-[10px]">Нужно в месяц</p>
                <p className="text-text-primary text-sm font-semibold mt-0.5">
                  {plan.requiredMonthly != null ? formatMoney(plan.requiredMonthly, true) : '—'}
                </p>
              </div>
              <div className="bg-bg-card2 rounded-xl p-2.5">
                <p className="text-text-muted text-[10px]">Фактический темп</p>
                <p className="text-text-primary text-sm font-semibold mt-0.5">
                  {formatMoney(plan.actualMonthly, true)}
                </p>
              </div>
            </div>

            {plan.status === 'behind' && plan.projectedDate && (
              <p className="text-accent-yellow text-[11px] mb-3">
                При текущем темпе цель закроется к {plan.projectedDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
              </p>
            )}

            <button onClick={() => { setTopup(g); setTopupFrom(accounts?.find(a => a.id !== g.fundingAccountId)?.id ?? '') }}
              className="w-full bg-accent text-white text-sm font-semibold py-2.5 rounded-xl active:scale-95 transition-transform">
              Пополнить
            </button>
          </div>
        )
      })}

      {/* создание */}
      <Sheet open={showCreate} title="Новая цель" onClose={() => setShowCreate(false)}>
        <div className="flex flex-col gap-4">
          <Field label="Тип цели">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setForm(f => ({ ...f, kind: 'save' }))}
                className={`py-2.5 rounded-xl text-xs font-semibold ${form.kind === 'save' ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                🎯 Накопить сумму
              </button>
              <button onClick={() => setForm(f => ({ ...f, kind: 'cushion', icon: '🛟' }))}
                className={`py-2.5 rounded-xl text-xs font-semibold ${form.kind === 'cushion' ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                🛟 Подушка
              </button>
            </div>
          </Field>

          <Field label="Название">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder={form.kind === 'cushion' ? 'Финансовая подушка' : 'Например, отпуск'} className={inputCls} />
          </Field>

          {form.kind === 'cushion' ? (
            <>
              <Field label="На сколько месяцев расходов">
                <div className="grid grid-cols-4 gap-2">
                  {['3', '6', '9', '12'].map(m => (
                    <button key={m} onClick={() => setForm(f => ({ ...f, cushionMonths: m }))}
                      className={`py-2 rounded-xl text-xs font-semibold ${form.cushionMonths === m ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                      {m} мес
                    </button>
                  ))}
                </div>
              </Field>
              <div className="bg-accent/10 border border-accent/20 rounded-xl p-3">
                <p className="text-text-muted text-xs">Цель рассчитана из ваших расходов</p>
                <p className="text-text-primary text-lg font-bold mt-1">
                  {formatMoney(burn * Number(form.cushionMonths || '6'))}
                </p>
                <p className="text-text-muted text-[11px] mt-1">
                  Средний расход {formatMoney(burn, true)}/мес за последние 3 месяца
                </p>
              </div>
            </>
          ) : (
            <Field label="Целевая сумма, ₽">
              <input inputMode="decimal" value={form.target}
                onChange={e => setForm(f => ({ ...f, target: e.target.value }))} className={inputCls} />
            </Field>
          )}

          <Field label="Счёт, на котором копите">
            <select value={form.fundingAccountId}
              onChange={e => setForm(f => ({ ...f, fundingAccountId: e.target.value }))}
              className={inputCls}>
              <option value="">Не привязывать (вести вручную)</option>
              {accounts?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <p className="text-text-muted text-[11px] mt-1.5">
              Если привязать счёт, прогресс берётся из его реального баланса,
              а пополнение цели становится настоящим переводом денег.
            </p>
          </Field>

          {!form.fundingAccountId && (
            <Field label="Уже накоплено, ₽">
              <input inputMode="decimal" value={form.manual}
                onChange={e => setForm(f => ({ ...f, manual: e.target.value }))} className={inputCls} />
            </Field>
          )}

          <Field label="Срок (необязательно)">
            <input type="date" value={form.deadline}
              onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} className={inputCls} />
          </Field>

          <Field label="Иконка">
            <div className="flex flex-wrap gap-2">
              {ICONS.map(ic => (
                <button key={ic} onClick={() => setForm(f => ({ ...f, icon: ic }))}
                  className={`w-11 h-11 rounded-xl text-xl flex items-center justify-center ${
                    form.icon === ic ? 'bg-accent' : 'bg-bg-card2'}`}>
                  {ic}
                </button>
              ))}
            </div>
          </Field>

          {error && <p className="text-accent-red text-xs">{error}</p>}
          <button onClick={create} disabled={busy || !form.title.trim()} className={primaryBtn}>
            Создать цель
          </button>
        </div>
      </Sheet>

      {/* пополнение */}
      <Sheet open={Boolean(topup)} title="Пополнить цель" subtitle={topup?.title} onClose={() => setTopup(null)}>
        <div className="flex flex-col gap-4">
          <Field label="Сумма, ₽">
            <input inputMode="decimal" value={topupAmt} autoFocus
              onChange={e => setTopupAmt(e.target.value)} className={inputCls} />
          </Field>

          {topup?.fundingAccountId ? (
            <Field label="Списать со счёта">
              <select value={topupFrom} onChange={e => setTopupFrom(e.target.value)} className={inputCls}>
                <option value="">Только отметить, без движения денег</option>
                {accounts?.filter(a => a.id !== topup.fundingAccountId)
                  .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="text-text-muted text-[11px] mt-1.5">
                Будет создан перевод на целевой счёт — общий баланс не изменится.
              </p>
            </Field>
          ) : (
            <p className="text-text-muted text-[11px]">
              Цель не привязана к счёту, поэтому пополнение только меняет счётчик.
              Привяжите счёт, чтобы деньги двигались по-настоящему.
            </p>
          )}

          {error && <p className="text-accent-red text-xs">{error}</p>}
          <button onClick={doTopup} disabled={busy || toMinor(topupAmt) <= 0} className={primaryBtn}>
            Пополнить
          </button>
        </div>
      </Sheet>
    </div>
  )
}

export { updateGoal }
