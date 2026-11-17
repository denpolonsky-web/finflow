/**
 * Настройки ввода, живущие на устройстве. В облако не уезжают и в очередь синка
 * не попадают — это про то, как человеку удобно набирать на ЭТОМ устройстве.
 *
 * Сбрасываются при выходе из аккаунта: после повторной авторизации ввод
 * возвращается к стандартному виду. `wipeLocal` чистит только IndexedDB,
 * поэтому localStorage нужно чистить отдельно — иначе «сброс» не срабатывал бы.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Подписка на изменения
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Большинство экранов читает настройки при монтировании — этого хватает,
 * потому что смена вкладки экран размонтирует. Но нижняя навигация и шапка
 * аналитики живут дольше: их настройку меняют, пока они на экране, и без
 * подписки изменение было бы видно только после перезагрузки.
 *
 * Счётчик версий + слушатели — ровно то, что нужно `useSyncExternalStore`
 * (хук `usePrefsVersion` в `src/hooks/useUiPrefs.ts`).
 */
const listeners = new Set<() => void>()
let version = 0

export function subscribePrefs(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export const prefsVersion = (): number => version

function changed(): void {
  version++
  for (const l of listeners) l()
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* приватный режим — переживём */ }
  changed()
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null                                 // приватный режим или битое значение
  }
}

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
  | 'runway' | 'anomalies' | 'topExpense' | 'topCategory'
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
  // Факты месяца. Включены по умолчанию: они ничего не предсказывают,
  // а когда расходов за месяц нет — просто не показываются.
  { id: 'topExpense', label: 'Крупнейшая трата месяца', hint: 'Самая большая покупка и её доля в расходах', group: 'Главная', predictive: false },
  { id: 'topCategory', label: 'Топ-категория месяца', hint: 'На что ушло больше всего и какая это доля', group: 'Главная', predictive: false },
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
  write(WIDGETS_KEY, p)
}

// ─────────────────────────────────────────────────────────────────────────────
// Цвета сумм в списках операций
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Каким цветом красить сумму операции. Раньше цвета были зашиты классами
 * Tailwind (`text-accent-red` и т.п.), поэтому «всё красное» было не исправить
 * из интерфейса. Теперь это произвольный цвет, который человек выбирает сам.
 *
 * Хранится строкой `#rrggbb`: ровно то, что отдаёт `<input type="color">`.
 * Живёт на устройстве, как и остальные настройки отображения.
 */
export interface AmountColors {
  expense: string
  income: string
  transfer: string
  /**
   * Красить сумму расхода цветом его категории, а не единым цветом расходов.
   * Действует в списках операций; итоги и плитки остаются единого цвета —
   * у суммы за период категории нет.
   */
  byCategory: boolean
}

/** Прежние зашитые цвета — accent-red / accent-green / text-secondary. */
export const DEFAULT_AMOUNT_COLORS: AmountColors = {
  expense: '#FF5C7A',
  income: '#00C896',
  transfer: '#8080A8',
  byCategory: false,
}

export type AmountColorId = 'expense' | 'income' | 'transfer'

export const AMOUNT_COLOR_FIELDS: { id: AmountColorId; label: string }[] = [
  { id: 'expense', label: 'Расходы' },
  { id: 'income', label: 'Доходы' },
  { id: 'transfer', label: 'Переводы' },
]

const COLORS_KEY = 'finflow.amountColors'

/** `#rgb` и `#rrggbb` — всё остальное считаем мусором и берём значение по умолчанию. */
function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)
}

export function loadAmountColors(): AmountColors {
  try {
    const raw = localStorage.getItem(COLORS_KEY)
    if (!raw) return { ...DEFAULT_AMOUNT_COLORS }
    const p = JSON.parse(raw) as Partial<Record<keyof AmountColors, unknown>>
    return {
      expense: isHex(p.expense) ? p.expense : DEFAULT_AMOUNT_COLORS.expense,
      income: isHex(p.income) ? p.income : DEFAULT_AMOUNT_COLORS.income,
      transfer: isHex(p.transfer) ? p.transfer : DEFAULT_AMOUNT_COLORS.transfer,
      // записано прошлой версией — поля нет, остаёмся на едином цвете
      byCategory: p.byCategory === true,
    }
  } catch {
    return { ...DEFAULT_AMOUNT_COLORS }
  }
}

export function saveAmountColors(c: AmountColors): void {
  write(COLORS_KEY, c)
}

/** Цвет суммы по типу операции. */
export function amountColor(type: string, colors: AmountColors): string {
  if (type === 'income') return colors.income
  if (type === 'transfer') return colors.transfer
  return colors.expense
}

// ─────────────────────────────────────────────────────────────────────────────
// Что показывать: нижняя навигация, разделы и периоды аналитики
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Упорядоченный список включённых пунктов. Чистая функция — покрыта тестами.
 *
 * Читает сохранённое по реестру: незнакомые id (остались от прошлой версии)
 * отбрасываются, дубли схлопываются, обязательные пункты возвращаются на место,
 * даже если их в сохранённом нет. Пустой результат заменяется значением
 * по умолчанию — экран без единого раздела был бы тупиком.
 */
export function normalizeList<T extends string>(
  saved: unknown,
  known: readonly T[],
  fallback: readonly T[],
  required: readonly T[] = [],
): T[] {
  const out: T[] = []
  if (Array.isArray(saved)) {
    for (const v of saved) {
      if (known.includes(v as T) && !out.includes(v as T)) out.push(v as T)
    }
  } else {
    out.push(...fallback)
  }
  for (const r of required) if (!out.includes(r)) out.unshift(r)
  return out.length ? out : [...fallback]
}

// ── Нижняя навигация ────────────────────────────────────────────────────────

export type NavTabId = 'home' | 'transactions' | 'stats' | 'goals' | 'accounts' | 'settings'

export interface NavTabMeta {
  id: NavTabId
  label: string
  hint: string
  /** пункт нельзя убрать из панели */
  locked?: boolean
}

/**
 * Реестр вкладок. «Главная» закреплена: с неё есть вход и в настройки,
 * и в счета — убрав её, можно было бы остаться без дороги к настройкам
 * и не вернуть панель обратно.
 */
export const NAV_TABS: NavTabMeta[] = [
  { id: 'home', label: 'Главная', hint: 'Остатки, факты месяца, последние операции', locked: true },
  { id: 'transactions', label: 'История', hint: 'Все операции и удалённые' },
  { id: 'stats', label: 'Аналитика', hint: 'Графики и разрезы' },
  { id: 'goals', label: 'Цели', hint: 'Накопления и вклады' },
  { id: 'accounts', label: 'Счета', hint: 'Остатки и сверка' },
  { id: 'settings', label: 'Настройки', hint: 'Оформление, категории, синхронизация' },
]

/** «Настройки» вместо «Счетов»: до счетов один шаг с главной, а настройки нужны чаще. */
export const DEFAULT_NAV: NavTabId[] = ['home', 'transactions', 'stats', 'goals', 'settings']

const NAV_KEY = 'finflow.nav'

export function loadNavTabs(): NavTabId[] {
  return normalizeList(read<unknown>(NAV_KEY), NAV_TABS.map(t => t.id), DEFAULT_NAV, ['home'])
}

export function saveNavTabs(tabs: NavTabId[]): void {
  write(NAV_KEY, tabs)
}

// ── Разделы аналитики ───────────────────────────────────────────────────────

export type StatsViewId =
  | 'overview' | 'days' | 'categories' | 'trends' | 'builder'
  | 'top' | 'income' | 'accounts' | 'weekdays' | 'budgets'

export interface StatsViewMeta { id: StatsViewId; label: string; hint: string }

export const STATS_VIEWS: StatsViewMeta[] = [
  { id: 'overview', label: 'Обзор', hint: 'Итоги периода, динамика и главные категории' },
  { id: 'days', label: 'Дни', hint: 'График, календарь и список дней — с операциями внутри' },
  { id: 'categories', label: 'Категории', hint: 'На что ушли деньги: сумма, доли, динамика' },
  { id: 'trends', label: 'Тренды', hint: 'Доходы и расходы по месяцам, накопление, подписки' },
  { id: 'builder', label: 'Отчёты', hint: 'Готовые отчёты и свой — любой показатель в любой разбивке' },
  { id: 'top', label: 'Крупные', hint: 'Самые большие траты периода' },
  { id: 'income', label: 'Доходы', hint: 'Откуда пришли деньги' },
  { id: 'accounts', label: 'Счета', hint: 'С какого счёта сколько потрачено' },
  { id: 'weekdays', label: 'Дни недели', hint: 'В какие дни тратится больше' },
  { id: 'budgets', label: 'Бюджеты', hint: 'Лимиты по категориям и сколько из них потрачено' },
]

/** Короткий набор по умолчанию; остальное включается карандашом в шапке. */
export const DEFAULT_STATS_VIEWS: StatsViewId[] = ['overview', 'days', 'categories', 'trends', 'builder']

const VIEWS_KEY = 'finflow.statsViews'

export function loadStatsViews(): StatsViewId[] {
  return normalizeList(read<unknown>(VIEWS_KEY), STATS_VIEWS.map(v => v.id), DEFAULT_STATS_VIEWS)
}

export function saveStatsViews(views: StatsViewId[]): void {
  write(VIEWS_KEY, views)
}

// ── Периоды ─────────────────────────────────────────────────────────────────

export type PeriodPref = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

export interface PeriodMeta { id: PeriodPref; label: string; hint: string }

export const PERIOD_OPTIONS: PeriodMeta[] = [
  { id: 'day', label: 'День', hint: 'Один день, со стрелками на соседние' },
  { id: 'week', label: 'Неделя', hint: 'С понедельника по воскресенье' },
  { id: 'month', label: 'Месяц', hint: 'Календарный месяц' },
  { id: 'quarter', label: 'Квартал', hint: 'Три месяца' },
  { id: 'year', label: 'Год', hint: 'Календарный год, графики по месяцам' },
  { id: 'custom', label: 'Свои даты', hint: 'Произвольный отрезок от и до' },
]

export const DEFAULT_PERIODS: PeriodPref[] = ['week', 'month', 'year']

const PERIODS_KEY = 'finflow.periods'

/** Порядок периодов не настраивается: от короткого к длинному, как в реестре. */
export function loadPeriods(): PeriodPref[] {
  const known = PERIOD_OPTIONS.map(p => p.id)
  const picked = normalizeList(read<unknown>(PERIODS_KEY), known, DEFAULT_PERIODS)
  return known.filter(id => picked.includes(id))
}

export function savePeriods(periods: PeriodPref[]): void {
  write(PERIODS_KEY, periods)
}

// ── Вид графиков ────────────────────────────────────────────────────────────

/**
 * Каким графиком показывать один и тот же расклад. Запоминается, потому что
 * это вкус: кому-то удобнее столбцы, кому-то линия — и выбирать заново
 * при каждом открытии аналитики незачем.
 */
export interface ChartModes {
  /** динамика периода в «Обзоре» */
  flow: 'bars' | 'area' | 'line'
  /** как показывать дни */
  days: 'list' | 'calendar'
  /** расклад по категориям, счетам и т.п. */
  breakdown: 'donut' | 'bars'
  /** сколько месяцев в «Трендах» */
  trendMonths: 6 | 12
}

export const DEFAULT_CHART_MODES: ChartModes = {
  flow: 'bars', days: 'list', breakdown: 'donut', trendMonths: 6,
}

const MODES_KEY = 'finflow.chartModes'

const oneOf = <T,>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed.includes(v as T) ? v as T : fallback)

export function loadChartModes(): ChartModes {
  const p = read<Partial<Record<keyof ChartModes, unknown>>>(MODES_KEY) ?? {}
  return {
    flow: oneOf(p.flow, ['bars', 'area', 'line'] as const, DEFAULT_CHART_MODES.flow),
    days: oneOf(p.days, ['list', 'calendar'] as const, DEFAULT_CHART_MODES.days),
    breakdown: oneOf(p.breakdown, ['donut', 'bars'] as const, DEFAULT_CHART_MODES.breakdown),
    trendMonths: oneOf(p.trendMonths, [6, 12] as const, DEFAULT_CHART_MODES.trendMonths),
  }
}

export function saveChartModes(m: ChartModes): void {
  write(MODES_KEY, m)
}

/** Вызывается при выходе из аккаунта вместе с остальными настройками устройства. */
export function resetDevicePrefs(): void {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(SCOPE_KEY)
    localStorage.removeItem(WIDGETS_KEY)
    localStorage.removeItem(COLORS_KEY)
    localStorage.removeItem(NAV_KEY)
    localStorage.removeItem(VIEWS_KEY)
    localStorage.removeItem(PERIODS_KEY)
    localStorage.removeItem(MODES_KEY)
  } catch { /* переживём */ }
  changed()
}
