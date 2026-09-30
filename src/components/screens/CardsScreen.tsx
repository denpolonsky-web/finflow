import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, X, Pencil, CreditCard, PiggyBank, RefreshCw } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { db } from '../../db'
import { formatMoney } from '../../utils/format'
import { BalanceGapDialog } from '../ui/BalanceGapDialog'
import type { Card } from '../../types'

const BANK_PRESETS = [
  { id: 'vtb',   name: 'ВТБ',    color: '#005CA9', gradient: 'from-blue-700 to-blue-900' },
  { id: 'tbank', name: 'Т-Банк', color: '#B8860B', gradient: 'from-yellow-600 to-yellow-800' },
  { id: 'sber',  name: 'Сбер',   color: '#21A038', gradient: 'from-green-600 to-green-800' },
  { id: 'alfa',  name: 'Альфа',  color: '#EF3124', gradient: 'from-red-500 to-red-700' },
  { id: 'raif',  name: 'Райф',   color: '#FFE500', gradient: 'from-yellow-400 to-orange-500' },
  { id: 'other', name: 'Другой', color: '#6C63FF', gradient: 'from-violet-600 to-indigo-700' },
]

type Tab = 'cards' | 'deposits'
type CardForm = { name: string; lastFour: string; balance: string; bankPreset: string }
type DepositForm = { name: string; bank: string; amount: string; interestRate: string; expectedDate: string }
type UpdateBalanceState = { card: Card; newBalance: string }

const emptyCard    = (): CardForm    => ({ name: '', lastFour: '', balance: '', bankPreset: 'other' })
const emptyDeposit = (): DepositForm => ({ name: '', bank: 'vtb', amount: '', interestRate: '', expectedDate: '' })

export function CardsScreen() {
  const [tab, setTab]                   = useState<Tab>('cards')
  const [showAdd, setShowAdd]           = useState(false)
  const [editCard, setEditCard]         = useState<Card | null>(null)
  const [cardForm, setCardForm]         = useState<CardForm>(emptyCard())
  const [showDeposit, setShowDeposit]   = useState(false)
  const [depositForm, setDepositForm]   = useState<DepositForm>(emptyDeposit())
  const [updateBal, setUpdateBal]       = useState<UpdateBalanceState | null>(null)
  const [gapCard, setGapCard]           = useState<{ card: Card; newBalance: number } | null>(null)

  const cards    = useLiveQuery(() => db.cards.toArray(), [])
  const deposits = useLiveQuery(() => db.deposits.toArray().then(all => all.filter(d => d.isActive)), [])

  const totalCards    = cards?.reduce((s, c) => s + c.balance, 0) ?? 0
  const totalDeposits = deposits?.reduce((s, d) => s + d.amount, 0) ?? 0

  // ── Card CRUD ─────────────────────────────────────────────────────────
  async function saveCard() {
    const preset = BANK_PRESETS.find(p => p.id === cardForm.bankPreset) ?? BANK_PRESETS[5]
    const now = new Date().toISOString()
    if (editCard) {
      await db.cards.update(editCard.id, {
        name: cardForm.name.trim(), bank: cardForm.bankPreset,
        balance: parseFloat(cardForm.balance || '0'),
        lastFour: cardForm.lastFour.slice(-4) || '0000',
        color: preset.color, updatedAt: now,
      })
      setEditCard(null)
    } else {
      const newCard = {
        id: uuid(), name: cardForm.name.trim(), bank: cardForm.bankPreset,
        balance: parseFloat(cardForm.balance || '0'),
        lastFour: cardForm.lastFour.slice(-4) || '0000',
        color: preset.color, updatedAt: now,
      }
      await db.cards.add(newCard)
      await db.syncQueue.add({ id: uuid(), entityType: 'card', entityId: newCard.id, operation: 'create', payload: newCard, createdAt: now })
      setShowAdd(false)
    }
    setCardForm(emptyCard())
  }

  // ── Manual balance update with gap dialog ─────────────────────────────
  async function confirmBalanceUpdate() {
    if (!updateBal) return
    const newBalance = parseFloat(updateBal.newBalance)
    if (isNaN(newBalance)) return
    const diff = Math.abs(newBalance - updateBal.card.balance)

    // Update card locally + sync
    const now = new Date().toISOString()
    await db.cards.update(updateBal.card.id, { balance: newBalance, updatedAt: now })
    await db.syncQueue.add({
      id: uuid(), entityType: 'card', entityId: updateBal.card.id, operation: 'update',
      payload: { ...updateBal.card, balance: newBalance, updatedAt: now }, createdAt: now,
    })

    // Show gap dialog if diff > 0
    if (diff > 0) {
      setGapCard({ card: updateBal.card, newBalance })
    }
    setUpdateBal(null)
  }

  // ── Deposit CRUD ──────────────────────────────────────────────────────
  async function saveDeposit() {
    const amount = parseFloat(depositForm.amount || '0')
    const rate   = parseFloat(depositForm.interestRate || '0')
    const days   = depositForm.expectedDate
      ? Math.max(1, Math.ceil((new Date(depositForm.expectedDate).getTime() - Date.now()) / 86400000))
      : 365
    const expectedAmount = amount * (1 + (rate / 100) * (days / 365))
    const now = new Date().toISOString()
    const newDeposit = {
      id: uuid(), name: depositForm.name.trim(), bank: depositForm.bank,
      amount, interestRate: rate, expectedDate: depositForm.expectedDate,
      expectedAmount: Math.round(expectedAmount),
      color: BANK_PRESETS.find(p => p.id === depositForm.bank)?.color ?? '#6C63FF',
      createdAt: now, isActive: true,
    }
    await db.deposits.add(newDeposit)
    await db.syncQueue.add({ id: uuid(), entityType: 'deposit', entityId: newDeposit.id, operation: 'create', payload: newDeposit, createdAt: now })
    setDepositForm(emptyDeposit())
    setShowDeposit(false)
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-bold">Счета</h1>
        <button
          onClick={() => tab === 'cards' ? (setShowAdd(true), setCardForm(emptyCard())) : setShowDeposit(true)}
          className="flex items-center gap-1.5 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-xl active:scale-95 transition-transform">
          <Plus size={16} /> Добавить
        </button>
      </div>

      {/* Tabs */}
      <div className="flex bg-bg-card border border-border rounded-2xl p-1">
        {(['cards','deposits'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === t ? 'bg-accent text-white' : 'text-text-secondary'}`}>
            {t === 'cards' ? <><CreditCard size={15} /> Карты</> : <><PiggyBank size={15} /> Вклады</>}
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className="bg-bg-card border border-border rounded-2xl p-4">
        <p className="text-text-muted text-xs">{tab === 'cards' ? 'Баланс на картах' : 'Сумма вкладов'}</p>
        <p className="text-text-primary text-2xl font-bold mt-1">
          {formatMoney(tab === 'cards' ? totalCards : totalDeposits)}
        </p>
      </div>

      {/* ── CARDS ── */}
      {tab === 'cards' && (
        <div className="flex flex-col gap-3">
          {!cards?.length ? (
            <div className="text-center py-12">
              <CreditCard size={40} className="text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary font-medium">Нет карт</p>
            </div>
          ) : cards.map(card => {
            const preset = BANK_PRESETS.find(p => p.id === card.bank) ?? BANK_PRESETS[5]
            return (
              <div key={card.id} className={`relative rounded-2xl p-5 bg-gradient-to-br ${preset.gradient} overflow-hidden`}>
                <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-white/5" />
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-white/70 text-xs font-medium">{card.name}</p>
                    <p className="text-white/40 text-xs mt-0.5">•••• {card.lastFour ?? '????'}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setUpdateBal({ card, newBalance: String(card.balance) })}
                      className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white/70 hover:text-white">
                      <RefreshCw size={13} />
                    </button>
                    <button onClick={() => { setEditCard(card); setCardForm({ name: card.name, lastFour: card.lastFour ?? '', balance: String(card.balance), bankPreset: card.bank }) }}
                      className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white/70 hover:text-white">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => db.cards.delete(card.id)}
                      className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white/70 hover:text-white">
                      <X size={13} />
                    </button>
                  </div>
                </div>
                <p className="text-white text-2xl font-bold">{formatMoney(card.balance)}</p>
                <p className="text-white/40 text-[10px] mt-1">
                  Обновлено: {new Date(card.updatedAt).toLocaleDateString('ru-RU')}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {/* ── DEPOSITS ── */}
      {tab === 'deposits' && (
        <div className="flex flex-col gap-3">
          {!deposits?.length ? (
            <div className="text-center py-12">
              <PiggyBank size={40} className="text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary font-medium">Нет вкладов</p>
              <p className="text-text-muted text-sm mt-1">Добавьте первый вклад</p>
            </div>
          ) : deposits.map(dep => {
            const daysLeft = dep.expectedDate
              ? Math.max(0, Math.ceil((new Date(dep.expectedDate).getTime() - Date.now()) / 86400000))
              : null
            const income = dep.expectedAmount - dep.amount
            return (
              <div key={dep.id} className="bg-bg-card border border-border rounded-2xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-text-primary font-bold">{dep.name}</p>
                    <p className="text-text-muted text-xs mt-0.5">{BANK_PRESETS.find(p => p.id === dep.bank)?.name ?? dep.bank}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-accent/15 text-accent text-xs font-semibold px-2.5 py-1 rounded-lg">
                      {dep.interestRate}% год.
                    </span>
                    <button onClick={() => db.deposits.update(dep.id, { isActive: false })}
                      className="text-text-muted hover:text-accent-red transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 mb-3">
                  <div className="flex-1 bg-bg-card2 rounded-xl p-3">
                    <p className="text-text-muted text-[10px]">Сумма вклада</p>
                    <p className="text-text-primary text-sm font-bold mt-0.5">{formatMoney(dep.amount)}</p>
                  </div>
                  <div className="flex-1 bg-bg-card2 rounded-xl p-3">
                    <p className="text-text-muted text-[10px]">Получите</p>
                    <p className="text-accent-green text-sm font-bold mt-0.5">{formatMoney(dep.expectedAmount)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-accent-green text-xs font-semibold">+{formatMoney(income)} доход</span>
                  {daysLeft !== null && (
                    <span className="text-text-muted text-xs">
                      📅 через {daysLeft} дн. — {new Date(dep.expectedDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Update balance sheet ── */}
      {updateBal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setUpdateBal(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl max-w-lg mx-auto p-5 pb-10">
            <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-border" /></div>
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-text-muted text-xs">Обновить баланс</p>
                <h2 className="text-text-primary text-lg font-bold">{updateBal.card.name}</h2>
              </div>
              <button onClick={() => setUpdateBal(null)}><X size={20} className="text-text-secondary" /></button>
            </div>
            <p className="text-text-muted text-xs mb-1.5">Текущий баланс: {formatMoney(updateBal.card.balance)}</p>
            <input
              type="number" inputMode="decimal" placeholder="Новый баланс ₽"
              value={updateBal.newBalance}
              onChange={e => setUpdateBal(u => u ? { ...u, newBalance: e.target.value } : null)}
              className="w-full bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-base font-bold placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent mb-4"
              autoFocus
            />
            <button onClick={confirmBalanceUpdate}
              disabled={!updateBal.newBalance || isNaN(parseFloat(updateBal.newBalance))}
              className="w-full h-12 bg-accent text-white font-bold rounded-xl disabled:opacity-40 active:scale-[.98] transition-transform">
              Обновить
            </button>
          </div>
        </>
      )}

      {/* ── Gap dialog ── */}
      {gapCard && (
        <BalanceGapDialog
          cardId={gapCard.card.id}
          cardName={gapCard.card.name}
          oldBalance={gapCard.card.balance}
          newBalance={gapCard.newBalance}
          onClose={() => setGapCard(null)}
        />
      )}

      {/* ── Card add/edit sheet ── */}
      {(showAdd || editCard) && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => { setShowAdd(false); setEditCard(null) }} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl max-w-lg mx-auto overflow-y-auto" style={{ maxHeight: '90dvh' }}>
            <div className="p-5 pb-10">
              <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-border" /></div>
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-text-primary text-lg font-bold">{editCard ? 'Редактировать карту' : 'Новая карта'}</h2>
                <button onClick={() => { setShowAdd(false); setEditCard(null) }}><X size={20} className="text-text-secondary" /></button>
              </div>
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-text-muted text-xs mb-2">Банк</p>
                  <div className="grid grid-cols-3 gap-2">
                    {BANK_PRESETS.map(p => (
                      <button key={p.id} onClick={() => setCardForm(f => ({ ...f, bankPreset: p.id, name: f.name || p.name }))}
                        className={`py-2.5 rounded-xl text-sm font-semibold transition-all ${cardForm.bankPreset === p.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
                <input placeholder="Название карты" value={cardForm.name} onChange={e => setCardForm(f => ({ ...f, name: e.target.value }))}
                  className="bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
                <input placeholder="Последние 4 цифры" type="number" inputMode="numeric" value={cardForm.lastFour}
                  onChange={e => setCardForm(f => ({ ...f, lastFour: e.target.value.slice(0, 4) }))}
                  className="bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent tracking-widest" />
                <input placeholder="Текущий баланс ₽" type="number" inputMode="decimal" value={cardForm.balance}
                  onChange={e => setCardForm(f => ({ ...f, balance: e.target.value }))}
                  className="bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
                <button onClick={saveCard} disabled={!cardForm.name.trim()}
                  className="w-full h-12 bg-accent text-white font-bold rounded-xl disabled:opacity-40 active:scale-[.98] transition-transform">
                  {editCard ? 'Сохранить' : 'Добавить карту'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Deposit add sheet ── */}
      {showDeposit && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setShowDeposit(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl max-w-lg mx-auto overflow-y-auto" style={{ maxHeight: '90dvh' }}>
            <div className="p-5 pb-10">
              <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-border" /></div>
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-text-primary text-lg font-bold">Новый вклад</h2>
                <button onClick={() => setShowDeposit(false)}><X size={20} className="text-text-secondary" /></button>
              </div>
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-text-muted text-xs mb-2">Банк</p>
                  <div className="grid grid-cols-3 gap-2">
                    {BANK_PRESETS.map(p => (
                      <button key={p.id} onClick={() => setDepositForm(f => ({ ...f, bank: p.id }))}
                        className={`py-2.5 rounded-xl text-sm font-semibold transition-all ${depositForm.bank === p.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
                <input placeholder="Название вклада" value={depositForm.name}
                  onChange={e => setDepositForm(f => ({ ...f, name: e.target.value }))}
                  className="bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
                <input placeholder="Сумма вклада ₽" type="number" inputMode="decimal" value={depositForm.amount}
                  onChange={e => setDepositForm(f => ({ ...f, amount: e.target.value }))}
                  className="bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
                <div className="relative">
                  <input placeholder="Процентная ставка" type="number" inputMode="decimal" value={depositForm.interestRate}
                    onChange={e => setDepositForm(f => ({ ...f, interestRate: e.target.value }))}
                    className="w-full bg-bg-card2 rounded-xl px-4 py-3 pr-16 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted text-sm">% год.</span>
                </div>
                <div>
                  <p className="text-text-muted text-xs mb-1.5">Дата поступления средств</p>
                  <input type="date" value={depositForm.expectedDate}
                    onChange={e => setDepositForm(f => ({ ...f, expectedDate: e.target.value }))}
                    className="w-full bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm outline-none focus:ring-1 focus:ring-accent" />
                </div>
                {depositForm.amount && depositForm.interestRate && depositForm.expectedDate && (() => {
                  const amt  = parseFloat(depositForm.amount)
                  const rate = parseFloat(depositForm.interestRate)
                  const days = Math.max(1, Math.ceil((new Date(depositForm.expectedDate).getTime() - Date.now()) / 86400000))
                  const exp  = Math.round(amt * (1 + (rate / 100) * (days / 365)))
                  return (
                    <div className="bg-accent/10 border border-accent/20 rounded-xl p-4">
                      <p className="text-text-muted text-xs mb-2">Предварительный расчёт</p>
                      <div className="flex justify-between">
                        <span className="text-text-secondary text-sm">Через {days} дн. получите:</span>
                        <span className="text-accent-green text-sm font-bold">{formatMoney(exp)}</span>
                      </div>
                    </div>
                  )
                })()}
                <button onClick={saveDeposit} disabled={!depositForm.name.trim() || !depositForm.amount}
                  className="w-full h-12 bg-accent text-white font-bold rounded-xl disabled:opacity-40 active:scale-[.98] transition-transform">
                  Добавить вклад
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
