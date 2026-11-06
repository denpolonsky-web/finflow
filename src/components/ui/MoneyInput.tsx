import { groupMoney, sanitizeMoneyInput } from '../../utils/money'

/**
 * Единое поле ввода денег. Набирается «как везде»: 10 → 10, 1000 → 1 000,
 * 1000000 → 1 000 000. Разрядка ставится на лету, копейки — после запятой.
 *
 * Раньше разрядка была только в экранном блоке цифр на экране операции,
 * а остальные восемь денежных полей принимали сырой текст без группировки.
 * Теперь формат один на всё приложение.
 *
 * Хранит строку, а не число: иначе на промежуточных состояниях («1,» или «0,0»)
 * контролируемое поле схлопывало бы ввод и дописать копейки было бы невозможно.
 * Сами функции формата живут в `utils/money.ts` — ими пользуется и блок цифр.
 */

interface Props {
  /** «сырое» значение поля: цифры и запятая, без разрядки */
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  'aria-label'?: string
}

export function MoneyInput({ value, onChange, placeholder, className, autoFocus, ...rest }: Props) {
  return (
    <input
      // text, а не number: у number нельзя показать разрядку, он режет запятую
      // по локали и подсовывает стрелки-спиннеры
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="done"
      value={groupMoney(value)}
      placeholder={placeholder}
      className={className}
      autoFocus={autoFocus}
      aria-label={rest['aria-label']}
      onChange={e => onChange(sanitizeMoneyInput(e.target.value))}
    />
  )
}
