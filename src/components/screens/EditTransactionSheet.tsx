import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { DEFAULT_CATEGORIES } from '../../db/categories'
import { updateTransaction } from '../../db/transactions'
import type { Transaction, TransactionType, CardId } from '../../types'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'

interface Props {
  tx: Transaction | null
  onClose: () => void
}

export function EditTransactionSheet({ tx, onClose }: Props) {
  const [type, setType]       = useState<TransactionType>('expense')
  const [amount, setAmount]   = useState('')
  const [catId, setCatId]     = useState('')
  const [cardId, setCardId]   = useState<CardId>('')
  const [title, setTitle]     = useState('')
  const [date, setDate]       = useState('')
  const [saving, setSaving]   = useState(false)

  const cards = useLiveQuery(() => db.cards.toArray(), [])

  useEffect(() => {
    if (!tx) return
    setType(tx.type)
    setAmount(String(tx.amount))
    setCatId(tx.categoryId)
    setCardId(tx.cardId)
    setTitle(tx.title)
    setDate(tx.date.slice(0, 16)) // datetime-local format
  }, [tx])

  if (!tx) return null

  const categories = DEFAULT_CATEGORIES.filter(c => c.type === type || c.type === 'both')

  async function handleSave() {
    if (!amount || parseFloat(amount) <= 0) return
    setSaving(true)
    try {
      await updateTransaction(tx!.id, {
        type,
        amount: parseFloat(amount),
        categoryId: catId,
        cardId,
        title,
        date: new Date(date).toISOString(),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl max-w-lg mx-auto overflow-y-auto" style={{ maxHeight: '92dvh' }}>
        <div className="p-5 pb-10">
          <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-border" /></div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-text-primary text-lg font-bold">Редактировать операцию</h2>
            <button onClick={onClose}><X size={20} className="text-text-secondary" /></button>
          </div>

          <div className="flex flex-col gap-4">
            {/* Type */}
            <div className="flex bg-bg-card2 rounded-xl p-1">
              {(['expense','income','transfer'] as TransactionType[]).map(t => (
                <button key={t} onClick={() => setType(t)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${type === t ? 'bg-accent text-white' : 'text-text-secondary'}`}>
                  {t === 'expense' ? 'Расход' : t === 'income' ? 'Доход' : 'Перевод'}
                </button>
              ))}
            </div>

            {/* Amount */}
            <div>
              <p className="text-text-muted text-xs mb-1.5">Сумма ₽</p>
              <input type="number" inputMode="decimal" value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-base font-bold placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
            </div>

            {/* Title */}
            <div>
              <p className="text-text-muted text-xs mb-1.5">Название</p>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                className="w-full bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" />
            </div>

            {/* Date */}
            <div>
              <p className="text-text-muted text-xs mb-1.5">Дата и время</p>
              <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm outline-none focus:ring-1 focus:ring-accent" />
            </div>

            {/* Category */}
            <div>
              <p className="text-text-muted text-xs mb-2">Категория</p>
              <div className="flex flex-wrap gap-2">
                {categories.map(cat => (
                  <button key={cat.id} onClick={() => setCatId(cat.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${catId === cat.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                    {cat.icon} {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Card */}
            <div>
              <p className="text-text-muted text-xs mb-2">Карта</p>
              <div className="flex gap-2">
                {cards?.map(card => (
                  <button key={card.id} onClick={() => setCardId(card.id)}
                    className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ${cardId === card.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                    {card.name}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={handleSave} disabled={saving || !amount}
              className="w-full h-12 bg-accent text-white font-bold rounded-xl disabled:opacity-40 active:scale-[.98] transition-transform">
              {saving ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
