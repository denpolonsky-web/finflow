import { useState, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, X, ImagePlus } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { db } from '../../db'
import { formatMoney } from '../../utils/format'
import type { Goal } from '../../types'

const GOAL_ICONS = ['🎮','✈️','🏠','🚗','📱','💻','🎓','💍','🏋️','🌍','🎸','📷','⌚','🛋️','🎯']

export function GoalsScreen() {
  const [showCreate, setShowCreate] = useState(false)
  const [showTopup, setShowTopup]   = useState<Goal | null>(null)
  const [topupAmt, setTopupAmt]     = useState('')
  const [form, setForm] = useState({ title: '', targetAmount: '', currentAmount: '', icon: '🎯', deadline: '', imageUrl: '' })
  const fileRef = useRef<HTMLInputElement>(null)

  const goals = useLiveQuery(
    () => db.goals.toArray().then(all => all.filter(g => !g.isArchived)),
    []
  )

  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setForm(f => ({ ...f, imageUrl: ev.target?.result as string }))
    reader.readAsDataURL(file)
  }

  async function createGoal() {
    if (!form.title.trim() || !form.targetAmount) return
    const now = new Date().toISOString()
    await db.goals.add({
      id: uuid(),
      title: form.title.trim(),
      icon: form.icon,
      targetAmount: parseFloat(form.targetAmount),
      currentAmount: parseFloat(form.currentAmount || '0'),
      deadline: form.deadline || undefined,
      createdAt: now,
      isArchived: false,
      imageUrl: form.imageUrl || undefined,
    } as Goal & { imageUrl?: string })
    setForm({ title: '', targetAmount: '', currentAmount: '', icon: '🎯', deadline: '', imageUrl: '' })
    setShowCreate(false)
  }

  async function topupGoal() {
    if (!showTopup) return
    const amt = parseFloat(topupAmt)
    if (!amt || amt <= 0) return
    await db.goals.update(showTopup.id, {
      currentAmount: Math.min(showTopup.targetAmount, showTopup.currentAmount + amt),
    })
    setShowTopup(null)
    setTopupAmt('')
  }

  const totalSaved  = goals?.reduce((s, g) => s + g.currentAmount, 0) ?? 0
  const totalTarget = goals?.reduce((s, g) => s + g.targetAmount, 0) ?? 0

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-bold">Цели</h1>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-xl active:scale-95 transition-transform">
          <Plus size={16} /> Новая
        </button>
      </div>

      {goals && goals.length > 0 && (
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
            <p className="text-accent-yellow text-lg font-bold mt-0.5">{formatMoney(totalTarget - totalSaved, true)}</p>
          </div>
        </div>
      )}

      {!goals || goals.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🎯</p>
          <p className="text-text-secondary text-base font-medium">Нет активных целей</p>
          <p className="text-text-muted text-sm mt-1">Создайте первую цель</p>
        </div>
      ) : goals.map(goal => {
        const g = goal as Goal & { imageUrl?: string }
        const pct = Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100))
        const daysLeft = g.deadline
          ? Math.max(0, Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000))
          : null
        const perMonth = g.deadline && daysLeft && daysLeft > 0
          ? Math.ceil((g.targetAmount - g.currentAmount) / (daysLeft / 30))
          : null

        return (
          <div key={g.id} className="bg-bg-card border border-border rounded-2xl overflow-hidden">
            {/* Goal image */}
            {g.imageUrl && (
              <div className="h-36 overflow-hidden">
                <img src={g.imageUrl} alt={g.title} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{g.icon}</span>
                  <div>
                    <p className="text-text-primary font-bold text-base">{g.title}</p>
                    {g.deadline && (
                      <p className="text-text-muted text-xs mt-0.5">
                        {daysLeft === 0 ? 'Сегодня дедлайн' : `${daysLeft} дн. осталось`}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${pct >= 100 ? 'text-accent-green' : 'text-text-secondary'}`}>
                    {pct}%
                  </span>
                  <button onClick={() => db.goals.update(g.id, { isArchived: true })}
                    className="text-text-muted hover:text-accent-red transition-colors">
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="h-2 rounded-full bg-bg-card2 overflow-hidden mb-2">
                <div className="h-full rounded-full bg-gradient-to-r from-accent to-indigo-400 transition-all duration-500"
                  style={{ width: `${pct}%` }} />
              </div>

              <div className="flex justify-between text-xs mb-3">
                <span className="text-accent font-semibold">{formatMoney(g.currentAmount, true)}</span>
                <span className="text-text-muted">{formatMoney(g.targetAmount, true)}</span>
              </div>

              {perMonth !== null && (
                <p className="text-text-muted text-xs mb-4">💡 ~{formatMoney(perMonth, true)}/мес чтобы успеть</p>
              )}

              <button onClick={() => setShowTopup(g)}
                className="w-full bg-accent text-white text-sm font-semibold py-2.5 rounded-xl active:scale-95 transition-transform">
                Пополнить
              </button>
            </div>
          </div>
        )
      })}

      {/* Create modal */}
      {showCreate && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl max-w-lg mx-auto overflow-y-auto" style={{ maxHeight: '90dvh' }}>
            <div className="p-5 pb-10">
              <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-border" /></div>
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-text-primary text-lg font-bold">Новая цель</h2>
                <button onClick={() => setShowCreate(false)}><X size={20} className="text-text-secondary" /></button>
              </div>
              <div className="flex flex-col gap-4">
                {/* Image upload */}
                <div>
                  <p className="text-text-muted text-xs mb-2">Фото цели (необязательно)</p>
                  {form.imageUrl ? (
                    <div className="relative h-32 rounded-2xl overflow-hidden">
                      <img src={form.imageUrl} alt="goal" className="w-full h-full object-cover" />
                      <button onClick={() => setForm(f => ({ ...f, imageUrl: '' }))}
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => fileRef.current?.click()}
                      className="w-full h-24 rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-text-muted hover:border-accent hover:text-accent transition-colors">
                      <ImagePlus size={22} />
                      <span className="text-xs">Добавить фото</span>
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
                </div>

                <input placeholder="Название цели *" value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
                <input placeholder="Целевая сумма ₽ *" type="number" inputMode="numeric" value={form.targetAmount}
                  onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))}
                  className="bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
                <input placeholder="Уже накоплено ₽" type="number" inputMode="numeric" value={form.currentAmount}
                  onChange={e => setForm(f => ({ ...f, currentAmount: e.target.value }))}
                  className="bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
                <input type="date" value={form.deadline}
                  onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))}
                  className="bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm outline-none focus:ring-1 focus:ring-accent" />

                <div>
                  <p className="text-text-muted text-xs mb-2">Иконка</p>
                  <div className="flex flex-wrap gap-2">
                    {GOAL_ICONS.map(ic => (
                      <button key={ic} onClick={() => setForm(f => ({ ...f, icon: ic }))}
                        className={`w-11 h-11 rounded-xl text-xl flex items-center justify-center transition-all ${form.icon === ic ? 'bg-accent ring-2 ring-accent ring-offset-2 ring-offset-bg-card' : 'bg-bg-card2'}`}>
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={createGoal} disabled={!form.title.trim() || !form.targetAmount}
                  className="w-full h-12 bg-accent text-white font-bold rounded-xl active:scale-[.98] transition-transform disabled:opacity-40">
                  Создать цель
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Topup modal */}
      {showTopup && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setShowTopup(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl max-w-lg mx-auto p-5 pb-10">
            <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-border" /></div>
            <div className="flex justify-between items-center mb-5">
              <div>
                <p className="text-text-muted text-xs">Пополнить цель</p>
                <h2 className="text-text-primary text-lg font-bold">{showTopup.title}</h2>
              </div>
              <button onClick={() => setShowTopup(null)}><X size={20} className="text-text-secondary" /></button>
            </div>
            <input placeholder="Сумма ₽" type="number" inputMode="numeric" value={topupAmt}
              onChange={e => setTopupAmt(e.target.value)}
              className="w-full bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent mb-4"
              autoFocus />
            <button onClick={topupGoal} disabled={!topupAmt || parseFloat(topupAmt) <= 0}
              className="w-full h-12 bg-accent text-white font-bold rounded-xl disabled:opacity-40">
              Добавить
            </button>
          </div>
        </>
      )}
    </div>
  )
}
