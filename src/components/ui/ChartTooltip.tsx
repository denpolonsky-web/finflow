import { formatMoney } from '../../utils/format'

/**
 * Подсказка графика — своя, вместо стандартной из recharts.
 *
 * Стандартная красит значение цветом серии. На тёмной карточке это тёмно-синий
 * или фиолетовый текст по тёмному фону: цифру, ради которой и наводят на
 * столбик, было не прочитать. Здесь значение всегда светлое и жирное, а цвет
 * серии остаётся только точкой-маркером слева.
 */

interface Item {
  name?: string | number
  value?: number | string
  color?: string
  payload?: Record<string, unknown>
}

interface Props {
  // эти три поля recharts подставляет сам
  active?: boolean
  payload?: Item[]
  label?: string | number
  /** значения в рублях (как их отдают графику) → показываем деньгами */
  money?: boolean
  /** подпись строки, когда у серии нет осмысленного имени */
  seriesName?: string
  /** заголовок вместо подписи оси — например, название категории у сектора */
  title?: (item: Item) => string | undefined
  /** строка под значениями: «нажмите, чтобы открыть операции» */
  hint?: string
}

export function ChartTooltip({ active, payload, label, money = true, seriesName, title, hint }: Props) {
  if (!active || !payload?.length) return null
  const head = title?.(payload[0]) ?? (label != null && label !== '' ? String(label) : undefined)

  return (
    <div className="rounded-xl border border-white/15 bg-[#22223A] px-3 py-2 shadow-xl shadow-black/50">
      {head && <p className="text-[11px] font-medium text-[#B4B4D6] mb-1">{head}</p>}
      <div className="flex flex-col gap-0.5">
        {payload.map((it, i) => {
          const dot = it.color ?? (it.payload?.fill as string | undefined) ?? '#6C63FF'
          const n = Number(it.value)
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full flex-none" style={{ background: dot }} />
              {/* имя серии нужно, только когда серий несколько */}
              {(payload.length > 1 || seriesName) && (
                <span className="text-[#B4B4D6]">{seriesName ?? it.name}</span>
              )}
              <span className="text-white font-bold ml-auto pl-3 tabular-nums">
                {money ? formatMoney(Math.round(n * 100)) : n}
              </span>
            </div>
          )
        })}
      </div>
      {hint && <p className="text-[10px] text-[#8C8CB4] mt-1.5">{hint}</p>}
    </div>
  )
}
