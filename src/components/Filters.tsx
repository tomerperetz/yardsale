import Link from 'next/link'
import type { Category } from '@prisma/client'
import { filterHref, type GridParams } from '@/lib/grid'
import { PriceSortControls } from '@/components/PriceSortControls'

const chip = (active: boolean) => (active ? 'chip on' : 'chip')

/**
 * Category filters are `<a>` elements built with `filterHref` — the grid
 * still works with JavaScript disabled and the back button lands correctly.
 * The price slider and sort select are a plain GET form (`PriceSortControls`)
 * for the same no-JS reason; a `<select>`/`<input type="range">` can't be a
 * link, so a form with a real submit button is the equivalent contract.
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

        <PriceSortControls category={current.category} maxPrice={current.maxPrice} sort={current.sort} />
      </div>
    </div>
  )
}
