import { categoryIcon, categoryName, isImageIcon } from '../../db/categories'

interface Props {
  id: string
  /** размер картинки в пикселях; на эмодзи не влияет — у него свой размер шрифта */
  size?: number
  className?: string
}

/**
 * Иконка категории: эмодзи выводится текстом, логотип — картинкой.
 *
 * Нужен отдельный компонент, потому что `categoryIcon` возвращает строку,
 * и у маркетплейсов это путь к файлу. Если вывести её текстом, как делали
 * все экраны раньше, в списке появится «/shops/ozon.png» вместо логотипа.
 */
export function CategoryIcon({ id, size = 22, className = '' }: Props) {
  const icon = categoryIcon(id)
  if (!isImageIcon(icon)) return <span className={className}>{icon}</span>
  return (
    <img
      src={icon}
      alt={categoryName(id)}
      loading="lazy"
      className={`rounded-md object-cover inline-block align-middle flex-none ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
