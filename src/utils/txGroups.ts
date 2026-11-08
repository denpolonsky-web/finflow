import type { Minor, Transaction } from '../types'
import { isoDateOnly } from './format'

export interface TxDayGroup {
  /** YYYY-MM-DD */
  date: string
  /** YYYY-MM — по нему рисуется разделитель месяца */
  month: string
  items: Transaction[]
  /** итог дня: доходы минус расходы; переводы и исключённые из статистики не в счёт */
  total: Minor
}

/**
 * Разбивка плоского списка операций по дням.
 *
 * Порядок входа СОХРАНЯЕТСЯ: и дни, и операции внутри дня идут так, как пришли.
 * Сортировать здесь нельзя — экран истории отдаёт уже отсортированный срез
 * (свежие сверху), и своя сортировка внутри сломала бы бесконечную подгрузку:
 * догруженный кусок переехал бы в середину списка.
 *
 * Итог дня считается по тем же правилам, что и вся статистика: операции
 * с `excludeFromStats` не учитываются, перевод не меняет итог (деньги остались
 * внутри кабинета, просто на другом счёте).
 *
 * День берём ЛОКАЛЬНЫЙ (`isoDateOnly`), а не срез ISO-строки. `tx.date` хранится
 * в UTC, и у `slice(0, 10)` операция, заведённая ночью, уезжает на сутки назад:
 * 7 ноября 00:34 по Москве — это 6 ноября 21:34 UTC, и свежая запись попадала
 * под заголовок «Вчера». Проверено вживую, так и было.
 */
/**
 * Докручивает срез бесконечной ленты до конца дня.
 *
 * Зачем: итог дня считается по тому, что передали в список. Если страница
 * обрывается посередине дня, итог посчитан по половине операций — и человек
 * видит рядом с датой сумму, которой у этого дня нет. Расширяем срез
 * до последней операции того же дня; на границе страницы это единицы строк.
 *
 * Список обязан быть упорядочен по дате (операции одного дня идут подряд) —
 * именно так его отдаёт экран истории.
 */
export function cutAtDayEnd(txs: Transaction[], limit: number): number {
  if (limit <= 0) return 0
  if (limit >= txs.length) return txs.length
  const day = isoDateOnly(txs[limit - 1].date)
  let i = limit
  while (i < txs.length && isoDateOnly(txs[i].date) === day) i++
  return i
}

export function groupByDay(txs: Transaction[]): TxDayGroup[] {
  const out: TxDayGroup[] = []
  const index = new Map<string, TxDayGroup>()

  for (const tx of txs) {
    const date = isoDateOnly(tx.date)
    let g = index.get(date)
    if (!g) {
      g = { date, month: date.slice(0, 7), items: [], total: 0 }
      index.set(date, g)
      out.push(g)
    }
    g.items.push(tx)
    if (tx.excludeFromStats) continue
    if (tx.type === 'expense') g.total -= tx.amount
    else if (tx.type === 'income') g.total += tx.amount
  }

  return out
}
