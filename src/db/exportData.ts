import { db } from './index'
import { categoryName } from './categories'
import { toMajor } from '../utils/money'

export function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const stamp = () => new Date().toISOString().slice(0, 10)

/** CSV с разделителем «;» и BOM — чтобы Excel на русской локали открыл корректно. */
export async function exportCsv(): Promise<void> {
  const [txs, accounts] = await Promise.all([
    db.transactions.orderBy('date').reverse().toArray(),
    db.accounts.toArray(),
  ])
  const accName = new Map(accounts.map(a => [a.id, a.name]))
  const head = ['Дата', 'Тип', 'Сумма', 'Валюта', 'Категория', 'Счёт', 'Счёт зачисления', 'Название', 'Комментарий', 'Вне статистики']
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = txs.map(t => [
    t.date,
    t.type === 'expense' ? 'Расход' : t.type === 'income' ? 'Доход' : 'Перевод',
    toMajor(t.amount).toFixed(2).replace('.', ','),
    'RUB',
    categoryName(t.categoryId),
    accName.get(t.accountId) ?? t.accountId,
    t.toAccountId ? (accName.get(t.toAccountId) ?? t.toAccountId) : '',
    t.title,
    t.comment ?? '',
    t.excludeFromStats ? 'да' : 'нет',
  ].map(esc).join(';'))
  download(`finflow-${stamp()}.csv`, '\uFEFF' + [head.map(esc).join(';'), ...rows].join('\r\n'), 'text/csv')
}

/** Полный дамп — из него можно восстановиться с нуля. */
export async function exportJson(): Promise<void> {
  const dump = {
    version: 3,
    exportedAt: new Date().toISOString(),
    note: 'Все суммы — в копейках (целое число).',
    accounts: await db.accounts.toArray(),
    transactions: await db.transactions.toArray(),
    postings: await db.postings.toArray(),
    goals: await db.goals.toArray(),
    budgets: await db.budgets.toArray(),
    snapshots: await db.snapshots.toArray(),
    settings: await db.settings.get(1),
    profiles: await db.profiles.toArray(),
  }
  download(`finflow-backup-${stamp()}.json`, JSON.stringify(dump, null, 2), 'application/json')
}
