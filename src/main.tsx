import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root не найден')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// последняя линия обороны: иначе необработанный reject не оставляет следов
window.addEventListener('unhandledrejection', e => {
  console.error('[unhandledrejection]', e.reason)
})
