import { useState } from 'react'
import { X } from 'lucide-react'
import { formatMoney } from '../../utils/format'
import { addTransaction } from '../../db/transactions'
import { DEFAULT_CATEGORIES } from '../../db/categories'

interface Props {
  cardId: string
  cardName: string
  oldBalance: number
  newBalance: number
  onClose: () => void
}

export function BalanceGapDialog({ cardId, cardName, oldBalance, newBalance, onClose }: Props) {
  const diff = newBalance - oldBalance
  const isPositive = diff > 0
  const [choice, setChoice] = useState<'record' | null>(null)
  const [catId, setCatId]   = useState(isPositive ? 'other_inc' : 'other_exp')
  const [title, setTitle]   = useState('Корректировка баланса')
  const [saving, setSaving] = useState(false)

  const categories = DEFAULT_CATEGORIES.filter(c =>
    isPositive ? (c.type === 'income' || c.type === 'both') : (c.type === 'expense' || c.type === 'both')
  )

  async function handleRecord() {
    setSaving(true)
    await addTransaction({
      type: isPositive ? 'income' : 'expense',
      amount: Math.abs(diff),
      categoryId: catId,
      cardId,
      title,
    })
    setSaving(false)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl max-w-lg mx-auto p-5 pb-10">
        <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-border" /></div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-text-primary text-lg font-bold">Обнаружено расхождение</h2>
          <button onClick={onClose}><X size={20} className="text-text-secondary" /></button>
        </div>

        <div className="bg-bg-card2 rounded-2xl p-4 mb-5">
          <p className="text-text-secondary text-sm mb-3">{cardName}</p>
          <div className="flex justify-between">
            <div>
              <p className="text-text-muted text-xs">Было</p>
              <p className="text-text-primary font-bold mt-0.5">{formatMoney(oldBalance)}</p>
            </div>
            <div className="text-center">
              <p className="text-text-muted text-xs">Разница</p>
              <p className={`font-bold text-lg mt-0.5 ${isPositive ? 'text-accent-green' : 'text-accent-red'}`}>
                {isPositive ? '+' : ''}{formatMoney(diff)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-text-muted text-xs">Стало</p>
              <p className="text-text-primary font-bold mt-0.5">{formatMoney(newBalance)}</p>
            </div>
          </div>
        </div>

        {!choice ? (
          <div className="flex flex-col gap-3">
            <button onClick={() => setChoice('record')}
              className="w-full bg-accent text-white font-semibold py-3.5 rounded-2xl active:scale-[.98] transition-transform">
              📝 Добавить в историю как операцию
            </button>
            <button onClick={onClose}
              className="w-full bg-bg-card2 text-text-secondary font-semibold py-3.5 rounded-2xl active:scale-[.98] transition-transform">
              Просто обновить баланс, не записывать
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-text-muted text-xs mb-1.5">Название операции</p>
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="w-full bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <p className="text-text-muted text-xs mb-2">Категория</p>
              <div className="flex flex-wrap gap-2">
                {categories.slice(0, 8).map(cat => (
                  <button key={cat.id} onClick={() => setCatId(cat.id)}
                    className={`flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium transition-all ${catId === cat.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'}`}>
                    {cat.icon} {cat.name}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={handleRecord} disabled={saving}
              className="w-full bg-accent text-white font-bold py-3.5 rounded-2xl disabled:opacity-40 active:scale-[.98] transition-transform">
              {saving ? 'Сохранение...' : 'Сохранить операцию'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
