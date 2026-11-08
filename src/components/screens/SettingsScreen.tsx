import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, Download, FileJson, LogOut, RefreshCw, CloudOff, Cloud, AlertTriangle, Trash2,
  Users, Plus, Lock, Pencil, Repeat, Tag, EyeOff,
} from 'lucide-react'
import { db, getMeta } from '../../db'
import { selectableCategories, categoryName, SERVICE_CATEGORY_IDS } from '../../db/categories'
import { CategoryIcon } from '../ui/CategoryIcon'
import { useCategories } from '../../store/CategoriesContext'
import { CategorySheet } from './CategorySheet'
import { setBudget } from '../../db/budgets'
import { exportCsv, exportJson } from '../../db/exportData'
import { enqueue } from '../../db/queue'
import { signOut } from '../../db/auth'
import { hasSupabase } from '../../db/supabase'
import { pushAll } from '../../db/sync'
import { formatMoney } from '../../utils/format'
import { toMinor } from '../../utils/money'
import { useApp } from '../../store/AppContext'
import { useProfile } from '../../store/ProfileContext'
import { ROLE_RIGHTS } from '../../db/profiles'
import { ProfileSheet } from './ProfileSheet'
import { inputCls } from '../ui/Sheet'
import { groupMoney, sanitizeMoneyInput, minorToInput } from '../../utils/money'
import {
  WIDGETS, loadWidgetPrefs, saveWidgetPrefs,
  AMOUNT_COLOR_FIELDS, DEFAULT_AMOUNT_COLORS, loadAmountColors, saveAmountColors,
  type AmountColors, type WidgetId, type WidgetPrefs,
} from '../../utils/uiPrefs'
import type { SyncStatus } from '../../hooks/useSync'
import type { Category, Minor, Profile } from '../../types'

/**
 * Строка бюджета. Отдельным компонентом, потому что поле контролируемое и
 * синхронизируется с базой по `key`: прежняя версия была неуправляемой
 * (`defaultValue` + `onBlur`) и не обновлялась, если бюджет менялся не здесь.
 * Запись в базу — на blur, чтобы не писать на каждое нажатие.
 */
function BudgetRow({ categoryId, amount }: { categoryId: string; amount: Minor | null }) {
  const [draft, setDraft] = useState(() => minorToInput(amount))
  return (
    <div className="flex items-center gap-3">
      <span className="text-lg w-6 text-center flex items-center justify-center">
        <CategoryIcon id={categoryId} size={20} />
      </span>
      <span className="text-text-secondary text-sm flex-1 truncate">{categoryName(categoryId)}</span>
      <input
        type="text"
        inputMode="decimal"
        value={groupMoney(draft)}
        placeholder="—"
        aria-label={`Лимит: ${categoryName(categoryId)}`}
        onChange={e => setDraft(sanitizeMoneyInput(e.target.value))}
        onBlur={() => { void setBudget(categoryId, toMinor(draft)) }}
        className="w-28 bg-bg-card2 rounded-lg px-3 py-2 text-text-primary text-sm text-right outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  )
}

interface Props {
  syncStatus: SyncStatus
  pending: number
  dead: number
  lastError: string | null
  onSync: () => void
  onSignedOut: () => void
  onSwitchProfile: () => void
}

export function SettingsScreen({ syncStatus, pending, dead, lastError, onSync, onSignedOut, onSwitchProfile }: Props) {
  const { setActiveTab, showToast } = useApp()
  const { profiles, profile: me, canSeeAll } = useProfile()
  const [editProfile, setEditProfile] = useState<Profile | null>(null)
  const [creating, setCreating] = useState(false)
  const settings = useLiveQuery(() => db.settings.get(1), [])
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [])
  const deadItems = useLiveQuery(() => db.syncQueue.where('dead').equals(1).toArray(), [], [])
  const userId = useLiveQuery(() => getMeta('userId'), [])
  const counts = useLiveQuery(async () => ({
    accounts: await db.accounts.count(),
    transactions: await db.transactions.count(),
    postings: await db.postings.count(),
  }), [])

  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [widgets, setWidgets] = useState<WidgetPrefs>(loadWidgetPrefs)
  const [colors, setColors] = useState<AmountColors>(loadAmountColors)
  const [editCategory, setEditCategory] = useState<Category | null>(null)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  const categories = useCategories()
  const userVisible = categories.filter(c => !SERVICE_CATEGORY_IDS.has(c.id))
  const visibleCategories = userVisible.filter(c => !c.isArchived)
  const hiddenCategories = userVisible.filter(c => c.isArchived)

  /**
   * Настройки отображения живут на устройстве. Экраны читают их при
   * монтировании, а переключение вкладки экран размонтирует — поэтому
   * изменение видно сразу при возврате, без перезагрузки страницы.
   */
  function toggleWidget(id: WidgetId, on: boolean) {
    const next = { ...widgets, [id]: on }
    setWidgets(next)
    saveWidgetPrefs(next)
  }

  /** Цвета читаются экранами при монтировании — как и подсказки выше. */
  function setColor(id: keyof AmountColors, value: string) {
    const next = { ...colors, [id]: value }
    setColors(next)
    saveAmountColors(next)
  }

  function resetColors() {
    const next = { ...DEFAULT_AMOUNT_COLORS }
    setColors(next)
    saveAmountColors(next)
  }

  const budgetFor = (catId: string) => budgets.find(b => b.categoryId === catId)

  async function saveName() {
    if (name == null) return
    const now = new Date().toISOString()
    const next = { ...(settings ?? { id: 1 as const, currency: 'RUB' as const, theme: 'dark' as const, runwayWindowMonths: 3 }), userName: name.trim(), updatedAt: now }
    await db.settings.put(next)
    // без enqueue настройки оставались только на этом устройстве
    await enqueue('settings', 'settings', 'upsert', next)
    showToast('Имя сохранено')
    setName(null)
  }

  async function doSignOut() {
    if (!confirm('Выйти из аккаунта? Локальные данные на этом устройстве будут удалены, в облаке всё останется.')) return
    setBusy(true)
    try { await signOut(); onSignedOut() } finally { setBusy(false) }
  }

  async function forcePush() {
    setBusy(true)
    try {
      const n = await pushAll()
      onSync()
      showToast(`В очередь поставлено ${n} записей`)
    } finally { setBusy(false) }
  }

  async function dropDead() {
    await db.syncQueue.where('dead').equals(1).delete()
    showToast('Застрявшие записи удалены из очереди')
  }

  const statusView: Record<SyncStatus, { icon: React.ReactNode; text: string; cls: string }> = {
    local:   { icon: <CloudOff size={16} />, text: 'Локальный режим, облако не подключено', cls: 'text-text-muted' },
    offline: { icon: <CloudOff size={16} />, text: 'Нет сети — изменения копятся локально', cls: 'text-text-secondary' },
    syncing: { icon: <RefreshCw size={16} className="animate-spin" />, text: 'Синхронизация…', cls: 'text-accent' },
    pending: { icon: <Cloud size={16} />, text: `Ожидают отправки: ${pending}`, cls: 'text-accent-yellow' },
    error:   { icon: <AlertTriangle size={16} />, text: lastError ?? `Застряло записей: ${dead}`, cls: 'text-accent-red' },
    online:  { icon: <Cloud size={16} />, text: 'Всё синхронизировано', cls: 'text-accent-green' },
  }
  const sv = statusView[syncStatus]

  return (
    <div className="flex flex-col gap-5 pb-28">
      <div className="flex items-center gap-3">
        <button onClick={() => setActiveTab('home')} aria-label="Назад"
          className="w-9 h-9 rounded-full bg-bg-card border border-border flex items-center justify-center text-text-secondary">
          <ArrowLeft size={17} />
        </button>
        <h1 className="text-text-primary text-2xl font-bold">Настройки</h1>
      </div>

      {/* профиль */}
      <section className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-text-secondary text-xs uppercase tracking-widest">Профиль</p>
        <input value={name ?? settings?.userName ?? ''} onChange={e => setName(e.target.value)}
          placeholder="Имя" className={inputCls} />
        {name != null && name !== settings?.userName && (
          <button onClick={saveName} className="bg-accent text-white text-sm font-semibold py-2.5 rounded-xl">
            Сохранить
          </button>
        )}
      </section>

      {/* синхронизация */}
      <section className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-text-secondary text-xs uppercase tracking-widest">Синхронизация</p>
        <div className={`flex items-center gap-2 text-sm ${sv.cls}`}>
          {sv.icon} <span>{sv.text}</span>
        </div>
        {counts && (
          <p className="text-text-muted text-[11px]">
            Локально: {counts.accounts} счетов, {counts.transactions} операций, {counts.postings} проводок
          </p>
        )}
        {hasSupabase && (
          <div className="flex gap-2">
            <button onClick={onSync} disabled={busy}
              className="flex-1 bg-bg-card2 text-text-primary text-xs font-semibold py-2.5 rounded-xl flex items-center justify-center gap-1.5">
              <RefreshCw size={14} /> Синхронизировать
            </button>
            {/* полная переотправка — действие на весь кабинет, не для ограниченной роли */}
            {canSeeAll && (
              <button onClick={forcePush} disabled={busy}
                className="flex-1 bg-bg-card2 text-text-primary text-xs font-semibold py-2.5 rounded-xl">
                Отправить всё заново
              </button>
            )}
          </div>
        )}
        {deadItems.length > 0 && (
          <div className="bg-accent-red/10 border border-accent-red/20 rounded-xl p-3">
            <p className="text-accent-red text-xs font-semibold mb-1">
              {deadItems.length} записей не удалось отправить
            </p>
            <p className="text-text-muted text-[11px] mb-2 break-words">
              {deadItems[0].entityType}: {deadItems[0].lastError}
            </p>
            <button onClick={dropDead} className="text-accent-red text-xs underline">
              Убрать их из очереди
            </button>
          </div>
        )}
        {userId && <p className="text-text-muted text-[10px] break-all">ID аккаунта: {userId}</p>}
      </section>

      {/* бюджеты — лимиты на весь кабинет, по ROLE_RIGHTS их задаёт только главная роль */}
      {canSeeAll && (
      <section className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
        <div>
          <p className="text-text-secondary text-xs uppercase tracking-widest">Бюджеты по категориям</p>
          <p className="text-text-muted text-[11px] mt-1">
            Месячный лимит. Пустое поле — бюджет снят.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {selectableCategories('expense').map(c => (
            <BudgetRow key={c.id} categoryId={c.id} amount={budgetFor(c.id)?.amount ?? null} />
          ))}
        </div>
        {budgets.length > 0 && (
          <p className="text-text-muted text-[11px]">
            Всего лимитов: {formatMoney(budgets.reduce((s, b) => s + b.amount, 0))}/мес
          </p>
        )}
      </section>
      )}

      {/* категории */}
      {canSeeAll && (
      <section className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-text-secondary text-xs uppercase tracking-widest flex items-center gap-1.5">
            <Tag size={12} /> Категории
          </p>
          <button onClick={() => { setEditCategory(null); setCreatingCategory(true) }}
            className="text-accent text-xs font-medium flex items-center gap-1">
            <Plus size={12} /> Добавить
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {visibleCategories.map(c => (
            <button key={c.id} onClick={() => setEditCategory(c)}
              className="flex items-center gap-1.5 bg-bg-card2 rounded-xl px-3 py-2 text-xs text-text-secondary">
              <CategoryIcon id={c.id} size={16} />
              <span>{c.name}</span>
              {c.essential && <span className="text-text-muted text-[10px]">обяз.</span>}
            </button>
          ))}
        </div>

        {hiddenCategories.length > 0 && (
          <>
            <button onClick={() => setShowHidden(s => !s)} className="text-text-muted text-xs text-left">
              {showHidden ? 'Скрыть спрятанные' : `Спрятанные (${hiddenCategories.length})`}
            </button>
            {showHidden && (
              <div className="flex flex-wrap gap-2">
                {hiddenCategories.map(c => (
                  <button key={c.id} onClick={() => setEditCategory(c)}
                    className="flex items-center gap-1.5 bg-bg-card2 rounded-xl px-3 py-2 text-xs text-text-muted opacity-60">
                    <EyeOff size={11} /> <CategoryIcon id={c.id} size={16} /> <span>{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <p className="text-text-muted text-[11px]">
          Встроенные можно переименовать, перекрасить и скрыть, но не удалить —
          на них ссылаются прошлые операции. Служебные (перевод, корректировка) не меняются.
        </p>
      </section>
      )}

      {/* подсказки */}
      <section className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
        <div>
          <p className="text-text-secondary text-xs uppercase tracking-widest">Подсказки и блоки</p>
          <p className="text-text-muted text-[11px] mt-1">
            Что показывать на экранах. Блоки с прогнозами выключены по умолчанию:
            они считают по малой выборке и часто ошибаются.
          </p>
        </div>
        {(['Главная', 'Аналитика', 'Цели и вклады'] as const).map(group => (
          <div key={group} className="flex flex-col gap-2">
            <p className="text-text-muted text-[10px] uppercase tracking-wider">{group}</p>
            {WIDGETS.filter(w => w.group === group).map(w => (
              <label key={w.id}
                className="flex items-start gap-3 bg-bg-card2 rounded-xl px-3 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={widgets[w.id]}
                  onChange={e => toggleWidget(w.id, e.target.checked)}
                  className="mt-0.5 accent-[#6C63FF] flex-none"
                />
                <span className="min-w-0">
                  <span className="text-text-primary text-sm block">
                    {w.label}
                    {w.predictive && (
                      <span className="text-text-muted text-[10px] ml-1.5">прогноз</span>
                    )}
                  </span>
                  <span className="text-text-muted text-[11px] block">{w.hint}</span>
                </span>
              </label>
            ))}
          </div>
        ))}
        <p className="text-text-muted text-[11px]">
          Настройка хранится на этом устройстве и не уезжает в облако.
        </p>
      </section>

      {/* цвета сумм */}
      <section className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
        <div>
          <p className="text-text-secondary text-xs uppercase tracking-widest">Цвета сумм</p>
          <p className="text-text-muted text-[11px] mt-1">
            Каким цветом показывать суммы в списках операций. Любой цвет из палитры.
          </p>
        </div>
        {AMOUNT_COLOR_FIELDS.map(f => (
          <label key={f.id}
            className="flex items-center gap-3 bg-bg-card2 rounded-xl px-3 py-2.5 cursor-pointer">
            <input
              type="color"
              value={colors[f.id]}
              onChange={e => setColor(f.id, e.target.value)}
              aria-label={`Цвет: ${f.label}`}
              className="w-9 h-9 rounded-lg bg-transparent border-0 p-0 cursor-pointer flex-none"
            />
            <span className="flex-1 text-text-primary text-sm">{f.label}</span>
            <span className="text-sm font-semibold" style={{ color: colors[f.id] }}>
              {f.id === 'income' ? '+' : f.id === 'expense' ? '−' : ''}1 234 ₽
            </span>
          </label>
        ))}
        <button onClick={resetColors} className="text-accent text-xs font-medium self-start">
          Вернуть стандартные
        </button>
        <p className="text-text-muted text-[11px]">
          Настройка хранится на этом устройстве и не уезжает в облако.
        </p>
      </section>

      {/* профили */}
      <section className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-text-secondary text-xs uppercase tracking-widest flex items-center gap-1.5">
            <Users size={12} /> Профили
          </p>
          <button onClick={onSwitchProfile} className="text-accent text-xs font-medium flex items-center gap-1">
            <Repeat size={12} /> Сменить
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {profiles.map(p => (
            <button key={p.id} disabled={!canSeeAll} onClick={() => setEditProfile(p)}
              className="flex items-center gap-3 bg-bg-card2 rounded-xl px-3 py-2.5 text-left disabled:opacity-100">
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-none"
                style={{ background: `${p.color}22` }}>{p.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm font-medium truncate">
                  {p.name}{p.id === me?.id && <span className="text-text-muted text-[10px]"> · вы</span>}
                </p>
                <p className="text-text-muted text-[10px] flex items-center gap-1">
                  {ROLE_RIGHTS[p.role].label}{p.pinHash && <Lock size={9} />}
                </p>
              </div>
              {canSeeAll && <Pencil size={13} className="text-text-muted flex-none" />}
            </button>
          ))}
        </div>

        {canSeeAll && (
          <button onClick={() => { setEditProfile(null); setCreating(true) }}
            className="bg-bg-card2 text-text-primary text-xs font-semibold py-2.5 rounded-xl flex items-center justify-center gap-1.5">
            <Plus size={14} /> Добавить профиль
          </button>
        )}

        <p className="text-text-muted text-[11px] leading-relaxed">
          Счета и операции общие на весь кабинет, статистика считается по каждому профилю отдельно.
          Роль разграничивает интерфейс, а не доступ к базе: все профили работают под одним входом,
          поэтому это защита от случайного взгляда, а не от целенаправленного.
        </p>
      </section>

      {/* экспорт — выгружает ВЕСЬ кабинет без фильтра по профилю, поэтому только
          главной роли: иначе ограниченный профиль получал чужие операции в CSV */}
      {canSeeAll && (
      <section className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
        <div>
          <p className="text-text-secondary text-xs uppercase tracking-widest">Экспорт</p>
          <p className="text-text-muted text-[11px] mt-1">
            JSON — полный бэкап, из него можно восстановиться. CSV открывается в Excel.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void exportCsv()}
            className="flex-1 bg-bg-card2 text-text-primary text-xs font-semibold py-2.5 rounded-xl flex items-center justify-center gap-1.5">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => void exportJson()}
            className="flex-1 bg-bg-card2 text-text-primary text-xs font-semibold py-2.5 rounded-xl flex items-center justify-center gap-1.5">
            <FileJson size={14} /> JSON
          </button>
        </div>
      </section>
      )}

      {/* аккаунт */}
      {hasSupabase && (
        <section className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
          <p className="text-text-secondary text-xs uppercase tracking-widest">Аккаунт</p>
          <button onClick={doSignOut} disabled={busy}
            className="bg-accent-red/10 text-accent-red text-sm font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
            <LogOut size={15} /> Выйти
          </button>
          <p className="text-text-muted text-[11px]">
            Перед выходом сделайте экспорт, если в очереди остались неотправленные записи.
          </p>
        </section>
      )}

      <section className="bg-bg-card border border-border rounded-2xl p-4">
        <p className="text-text-muted text-[11px] leading-relaxed">
          Суммы хранятся в копейках целым числом, балансы считаются из проводок —
          поэтому правка или удаление операции не может рассинхронизировать счёт.
          <br />
          {/* сброс затирает базу всего кабинета на устройстве — только главной роли */}
          {canSeeAll && (
            <button onClick={() => {
              if (confirm('Удалить ВСЕ локальные данные на этом устройстве? В облаке данные останутся.')) {
                void db.delete().then(() => window.location.reload())
              }
            }} className="text-accent-red mt-2 inline-flex items-center gap-1">
              <Trash2 size={11} /> Сбросить локальную базу
            </button>
          )}
        </p>
      </section>

      {(creating || editProfile) && (
        <ProfileSheet
          key={editProfile?.id ?? 'new'}
          profile={editProfile}
          onClose={() => { setCreating(false); setEditProfile(null) }}
        />
      )}

      {(creatingCategory || editCategory) && (
        <CategorySheet
          key={editCategory?.id ?? 'new-category'}
          category={editCategory}
          onClose={() => { setCreatingCategory(false); setEditCategory(null) }}
        />
      )}
    </div>
  )
}
