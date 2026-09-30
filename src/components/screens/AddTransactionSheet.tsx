import { useState, useEffect } from 'react'
import { X, Camera, ChevronRight } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { addTransaction } from '../../db/transactions'
import { DEFAULT_CATEGORIES } from '../../db/categories'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import type { TransactionType, CardId } from '../../types'

// Keyboard: 7 8 9 / 4 5 6 / 1 2 3 / ⌫ 0 ,
const NUMPAD = ['7','8','9','4','5','6','1','2','3','⌫','0',',']

type Step = 'amount' | 'details'

function formatDisplay(raw: string): string {
  const [int, dec] = raw.split(',')
  const intFormatted = new Intl.NumberFormat('ru-RU').format(parseInt(int || '0'))
  return dec !== undefined ? `${intFormatted},${dec}` : intFormatted
}

export function AddTransactionSheet() {
  const { isAddSheetOpen, closeAddSheet } = useApp()
  const [type, setType]           = useState<TransactionType>('expense')
  const [amountStr, setAmountStr] = useState('0')
  const [categoryId, setCategoryId] = useState('food')
  const [cardId, setCardId]       = useState<CardId>('vtb')
  const [title, setTitle]         = useState('')
  const [step, setStep]           = useState<Step>('amount')
  const [saving, setSaving]       = useState(false)

  const cards = useLiveQuery(() => db.cards.toArray(), [])

  useEffect(() => {
    if (isAddSheetOpen) {
      setAmountStr('0'); setType('expense'); setCategoryId('food')
      setCardId('vtb'); setTitle(''); setStep('amount'); setSaving(false)
    }
  }, [isAddSheetOpen])

  function handleNumpad(key: string) {
    if (key === '⌫') {
      setAmountStr(p => p.length > 1 ? p.slice(0, -1) : '0')
      return
    }
    if (key === ',' && amountStr.includes(',')) return
    if (amountStr === '0' && key !== ',') { setAmountStr(key); return }
    const [, dec] = amountStr.split(',')
    if (dec !== undefined && dec.length >= 2) return
    setAmountStr(p => p + key)
  }

  const amount = parseFloat(amountStr.replace(',', '.')) || 0
  const categories = DEFAULT_CATEGORIES.filter(c => c.type === type || c.type === 'both')
  const selCat = categories.find(c => c.id === categoryId) ?? categories[0]

  async function handleSave() {
    if (amount <= 0) return
    setSaving(true)
    try {
      await addTransaction({
        type, amount, categoryId: selCat.id, cardId,
        title: title || selCat.name,
      })
      closeAddSheet()
    } finally {
      setSaving(false)
    }
  }

  if (!isAddSheetOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={closeAddSheet} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl max-w-lg mx-auto overflow-hidden" style={{ maxHeight: '92dvh' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-text-primary text-lg font-bold">Новая операция</h2>
          <button onClick={closeAddSheet} className="w-8 h-8 rounded-full bg-bg-card2 flex items-center justify-center text-text-secondary">
            <X size={16} />
          </button>
        </div>

        <div className="flex mx-5 bg-bg-card2 rounded-xl p-1 mb-2">
          {(['expense','income','transfer'] as TransactionType[]).map(t => (
            <button key={t} onClick={() => setType(t)}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${type === t ? 'bg-accent text-white' : 'text-text-secondary'}`}>
              {t === 'expense' ? 'Расход' : t === 'income' ? 'Доход' : 'Перевод'}
            </button>
          ))}
        </div>

        {step === 'amount' ? (
          <>
            <div className="flex flex-col items-center py-5">
              <p className="text-text-muted text-sm mb-1">Сумма</p>
              <p className={`text-5xl font-bold tracking-tight ${
                type === 'income' ? 'text-accent-green' : type === 'expense' ? 'text-accent-red' : 'text-text-primary'
              }`}>
                {formatDisplay(amountStr)} <span className="text-3xl">₽</span>
              </p>
            </div>

            {/* Numpad: 7 8 9 / 4 5 6 / 1 2 3 / ⌫ 0 , */}
            <div className="grid grid-cols-3 gap-2 px-5 mb-4">
              {NUMPAD.map(key => (
                <button key={key} onClick={() => handleNumpad(key)}
                  className={`h-14 rounded-2xl text-xl font-bold active:scale-95 transition-transform flex items-center justify-center ${
                    key === '⌫' ? 'bg-accent-red/20 text-accent-red' : 'bg-bg-card2 text-text-primary'
                  }`}>
                  {key}
                </button>
              ))}
            </div>

            <div className="px-5 pb-8">
              <button disabled={amount <= 0} onClick={() => setStep('details')}
                className="w-full h-14 rounded-2xl bg-accent text-white font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[.98] transition-transform">
                Далее <ChevronRight size={18} />
              </button>
            </div>
          </>
        ) : (
          <div className="overflow-y-auto px-5 pb-10" style={{ maxHeight: '60dvh' }}>
            <div className="text-center mb-5">
              <p className={`text-3xl font-bold ${type === 'income' ? 'text-accent-green' : 'text-accent-red'}`}>
                {type === 'income' ? '+' : '−'}{formatDisplay(amountStr)} ₽
              </p>
              <button onClick={() => setStep('amount')} className="text-accent text-xs mt-1">← изменить</button>
            </div>

            <p className="text-text-muted text-xs uppercase tracking-widest mb-2">Категория</p>
            <div className="flex flex-wrap gap-2 mb-5">
              {categories.map(cat => (
                <button key={cat.id} onClick={() => setCategoryId(cat.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all ${
                    categoryId === cat.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'
                  }`}>
                  <span>{cat.icon}</span> {cat.name}
                </button>
              ))}
            </div>

            <p className="text-text-muted text-xs uppercase tracking-widest mb-2">Карта</p>
            <div className="flex gap-2 mb-5">
              {cards?.map(card => (
                <button key={card.id} onClick={() => setCardId(card.id as CardId)}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ${
                    cardId === card.id ? 'bg-accent text-white' : 'bg-bg-card2 text-text-secondary'
                  }`}>
                  {card.name}
                </button>
              ))}
            </div>

            <p className="text-text-muted text-xs uppercase tracking-widest mb-2">Название</p>
            <input type="text" placeholder={selCat?.name ?? 'Описание...'} value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent mb-5" />

            <button className="w-full flex items-center gap-3 bg-bg-card2 rounded-xl px-4 py-3 text-text-secondary text-sm mb-6 border border-dashed border-border hover:border-accent transition-colors">
              <Camera size={18} /> Сканировать QR-код чека
            </button>

            <button disabled={saving} onClick={handleSave}
              className="w-full h-14 rounded-2xl bg-accent text-white font-bold text-base active:scale-[.98] transition-transform disabled:opacity-60">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
