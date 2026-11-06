import React, { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}

export function Sheet({ open, title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl max-w-lg mx-auto overflow-y-auto"
        style={{ maxHeight: '92dvh', paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 bg-bg-card z-10 pt-3 px-5 pb-3">
          <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-border" /></div>
          <div className="flex items-start justify-between">
            <div>
              {subtitle && <p className="text-text-muted text-xs">{subtitle}</p>}
              <h2 className="text-text-primary text-lg font-bold">{title}</h2>
            </div>
            <button onClick={onClose} aria-label="Закрыть"
              className="w-8 h-8 rounded-full bg-bg-card2 flex items-center justify-center text-text-secondary">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="px-5 pb-8">{children}</div>
      </div>
    </>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-text-muted text-xs mb-1.5">{label}</p>
      {children}
    </div>
  )
}

export const inputCls =
  'w-full bg-bg-card2 rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent'

export const primaryBtn =
  'w-full h-12 bg-accent text-white font-bold rounded-xl disabled:opacity-40 active:scale-[.98] transition-transform'
