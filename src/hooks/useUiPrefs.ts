import { useSyncExternalStore } from 'react'
import { prefsVersion, subscribePrefs } from '../utils/uiPrefs'

/**
 * Номер версии настроек устройства. Сам по себе не нужен — нужен как повод
 * перерисоваться: компонент, вызвавший хук, обновится после любого сохранения
 * в `uiPrefs` и перечитает то, что ему надо.
 *
 * Нужен только долгоживущим компонентам (нижняя навигация, шапка аналитики).
 * Обычному экрану хватает чтения при монтировании.
 */
export function usePrefsVersion(): number {
  return useSyncExternalStore(subscribePrefs, prefsVersion, prefsVersion)
}
