import React from 'react'

interface State { error: Error | null }

/**
 * Без этого любое исключение в рендере давало белый экран без следов —
 * ровно то, из-за чего «ничего не происходит» невозможно было диагностировать.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-dvh bg-bg-primary text-text-primary flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-5xl">🛠</div>
        <h1 className="text-xl font-bold">Что-то сломалось</h1>
        <pre className="text-xs text-accent-red bg-bg-card border border-border rounded-xl p-3 max-w-full overflow-auto whitespace-pre-wrap">
          {this.state.error.message}
        </pre>
        <p className="text-text-muted text-xs text-center">
          Данные на устройстве не пострадали. Перезагрузите страницу.
        </p>
        <button onClick={() => window.location.reload()}
          className="bg-accent text-white font-semibold px-6 py-3 rounded-xl">
          Перезагрузить
        </button>
      </div>
    )
  }
}
