import Link from 'next/link'
import type { Category } from '@prisma/client'
import { filterHref, type GridParams, type GridSort } from '@/lib/grid'

// Shekel thresholds offered as chips; filterHref wants agorot.
const PRICE_STEPS_SHEKELS = [200, 500, 1000]

const SORTS: { value: GridSort; label: string }[] = [
  { value: 'new', label: 'הכי חדש' },
  { value: 'price-asc', label: 'מחיר: מהנמוך' },
  { value: 'price-desc', label: 'מחיר: מהגבוה' },
]

const chip = (active: boolean) => (active ? 'chip on' : 'chip')

/**
 * Every control here is an `<a>` built with `filterHref`: the grid works with
 * JavaScript disabled and the back button always lands on the right filters.
 */
export function Filters({ categories, current }: { categories: Category[]; current: GridParams }) {
  return (
    <div className="filters">
      <div className="frow">
        <Link href={filterHref(current, { category: undefined })} className={chip(!current.category)}>
          הכל
        </Link>
        {categories.map((c) => (
          <Link key={c.id} href={filterHref(current, { category: c.name })} className={chip(current.category === c.name)}>
            {c.name}
          </Link>
        ))}

        <div className="spacer" />

        {PRICE_STEPS_SHEKELS.map((shekels) => (
          <Link
            key={shekels}
            href={filterHref(current, { maxPrice: shekels * 100 })}
            className={chip(current.maxPrice === shekels * 100)}
          >
            עד ₪{shekels}
          </Link>
        ))}
        {current.maxPrice !== undefined && (
          <Link href={filterHref(current, { maxPrice: undefined })} className="chip">
            כל המחירים
          </Link>
        )}

        {SORTS.map((s) => (
          <Link key={s.value} href={filterHref(current, { sort: s.value })} className={chip(current.sort === s.value)}>
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
