/**
 * Настройки ввода, живущие на устройстве. В облако не уезжают и в очередь синка
 * не попадают — это про то, как человеку удобно набирать на ЭТОМ устройстве.
 *
 * Сбрасываются при выходе из аккаунта: после повторной авторизации ввод
 * возвращается к стандартному виду. `wipeLocal` чистит только IndexedDB,
 * поэтому localStorage нужно чистить отдельно — иначе «сброс» не срабатывал бы.
 */

/** Чем набираем сумму: экранный блок цифр или обычная клавиатура устройства. */
export type KeypadMode = 'pad' | 'keyboard'

/** Раскладка экранного блока: как на телефоне (1-2-3 сверху) или как на калькуляторе. */
export type PadLayout = 'phone' | 'calculator'

export interface KeypadPrefs {
  mode: KeypadMode
  layout: PadLayout
}

/** Стандартное положение, к которому возвращаемся после повторного входа. */
export const DEFAULT_KEYPAD: KeypadPrefs = { mode: 'pad', layout: 'phone' }

const KEY = 'finflow.keypad'

export function loadKeypadPrefs(): KeypadPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_KEYPAD
    const p = JSON.parse(raw) as Partial<KeypadPrefs>
    return {
      mode: p.mode === 'keyboard' ? 'keyboard' : 'pad',
      layout: p.layout === 'calculator' ? 'calculator' : 'phone',
    }
  } catch {
    return DEFAULT_KEYPAD                     // приватный режим или битое значение
  }
}

export function saveKeypadPrefs(p: KeypadPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* переживём */ }
}

/** Вызывается при выходе из аккаунта. */
export function resetKeypadPrefs(): void {
  try { localStorage.removeItem(KEY) } catch { /* переживём */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Разрез по профилям (G6.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Чьи операции показывать. Доступно только главной роли: ограниченная всегда
 * видит только себя, и переключателя у неё нет вовсе.
 * 'all' — весь кабинет, 'mine' — только свои, иначе id конкретного профиля.
 */
export type ViewScope = 'all' | 'mine' | (string & {})

const SCOPE_KEY = 'finflow.viewScope'

export function loadViewScope(): ViewScope {
  try { return localStorage.getItem(SCOPE_KEY) || 'all' } catch { return 'all' }
}

export function saveViewScope(v: ViewScope): void {
  try { localStorage.setItem(SCOPE_KEY, v) } catch { /* переживём */ }
}

/** Подпись текущего разреза — чтобы на экране было видно, что цифры неполные. */
export function scopeLabel(
  viewScope: ViewScope,
  profiles: { id: string; name: string }[],
  myName?: string,
): string {
  if (viewScope === 'all') return 'весь кабинет'
  if (viewScope === 'mine') return myName ? `только ${myName}` : 'только мои'
  return profiles.find(p => p.id === viewScope)?.name ?? 'профиль'
}

// ─────────────────────────────────────────────────────────────────────────────
// Подсказки и производные блоки (G6.5)
// ─────────────────────────────────────────────────────────────────────────────

export type WidgetId =
  | 'savingsRate' | 'runway' | 'anomalies'
  | 'forecast' | 'deltaPrev' | 'structure'
  | 'subscriptions' | 'cumulative'
  | 'goalRate' | 'depositForecast'

export interface WidgetMeta {
  id: WidgetId
  label: string
  hint: string
  group: 'Главная' | 'Аналитика' | 'Цели и вклады'
  /** блок строит прогноз, а не показывает факт */
  predictive: boolean
}

/**
 * Реестр настраиваемых блоков. Единственный источник правды и для настроек,
 * и для экранов — добавляя блок, добавляй его сюда, а не прячь за условием
 * в самом экране.
 *
 * Предиктивные блоки по умолчанию ВЫКЛЮЧЕНЫ: они экстраполируют по малой
 * выборке и чаще мешают, чем помогают. Фактические — включены.
 */
export const WIDGETS: WidgetMeta[] = [
  { id: 'savingsRate', label: 'Норма сбережений', hint: 'Доля дохода, которая осталась', group: 'Главная', predictive: false },
  { id: 'runway', label: 'Запас прочности', hint: 'На сколько месяцев хватит денег при текущем расходе', group: 'Главная', predictive: true },
  { id: 'anomalies', label: 'Необычные траты', hint: 'Категории, где расход заметно выбился из нормы', group: 'Главная', predictive: true },
  { id: 'structure', label: 'Структура расходов', hint: 'Обязательные против остального', group: 'Аналитика', predictive: false },
  { id: 'deltaPrev', label: 'Сравнение с прошлым периодом', hint: 'Насколько изменились расходы', group: 'Аналитика', predictive: false },
  { id: 'forecast', label: 'Прогноз на конец периода', hint: 'Оценка расхода по текущему темпу', group: 'Аналитика', predictive: true },
  { id: 'cumulative', label: 'Накопительная кривая', hint: 'Как расход набирался за период', group: 'Аналитика', predictive: false },
  { id: 'subscriptions', label: 'Похоже на подписки', hint: 'Догадка по повторяющимся платежам', group: 'Аналитика', predictive: true },
  { id: 'goalRate', label: 'Темп и прогноз по целям', hint: 'Нужный и фактический темп, дата достижения', group: 'Цели и вклады', predictive: true },
  { id: 'depositForecast', label: 'Прогноз по вкладу', hint: 'Сумма к дате окончания', group: 'Цели и вклады', predictive: true },
]

export type WidgetPrefs = Record<WidgetId, boolean>

export const DEFAULT_WIDGETS: WidgetPrefs = WIDGETS.reduce(
  (acc, w) => { acc[w.id] = !w.predictive; return acc },
  {} as WidgetPrefs,
)

const WIDGETS_KEY = 'finflow.widgets'

export function loadWidgetPrefs(): WidgetPrefs {
  try {
    const raw = localStorage.getItem(WIDGETS_KEY)
    if (!raw) return { ...DEFAULT_WIDGETS }
    const saved = JSON.parse(raw) as Partial<Record<string, unknown>>
    // читаем по реестру: лишние ключи из старых версий игнорируются,
    // новые блоки получают значение по умолчанию
    return WIDGETS.reduce((acc, w) => {
      acc[w.id] = typeof saved[w.id] === 'boolean' ? saved[w.id] as boolean : DEFAULT_WIDGETS[w.id]
      return acc
    }, {} as WidgetPrefs)
  } catch {
    return { ...DEFAULT_WIDGETS }
  }
}

export function saveWidgetPrefs(p: WidgetPrefs): void {
  try { localStorage.setItem(WIDGETS_KEY, JSON.stringify(p)) } catch { /* переживём */ }
}

/** Вызывается при выходе из аккаунта вместе с остальными настройками устройства. */
export function resetDevicePrefs(): void {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(SCOPE_KEY)
    localStorage.removeItem(WIDGETS_KEY)
  } catch { /* переживём */ }
}
