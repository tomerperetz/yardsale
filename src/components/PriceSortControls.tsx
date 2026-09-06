'use client'

import type { GridSort } from '@/lib/grid'
import { useState, type SyntheticEvent } from 'react'

const MIN_SHEKELS = 20
const MAX_SHEKELS = 1200

const SORTS: { value: GridSort; label: string }[] = [
  { value: 'new', label: 'הכי חדש' },
  { value: 'price-asc', label: 'מחיר: מהנמוך' },
  { value: 'price-desc', label: 'מחיר: מהגבוה' },
]

const clamp = (n: number) => Math.min(MAX_SHEKELS, Math.max(MIN_SHEKELS, n))

/**
 * The mockup's price slider and sort select, restored as a plain GET form so
 * they work with JavaScript disabled: dragging the slider and picking a
 * sort option are both native browser behaviour, and the submit button
 * commits them to the URL. When JS is present, releasing the slider or
 * picking a sort option submits automatically so it still feels live.
 *
 * The active category travels along as a hidden field — this component is
 * re-rendered fresh by the server on every navigation, so it always reflects
 * whichever category is currently applied, even after a category-chip click.
 */
export function PriceSortControls({
  category,
  maxPrice,
  sort,
}: {
  category?: string
  maxPrice?: number
  sort: GridSort
}) {
  const initialShekels = clamp(maxPrice !== undefined ? Math.round(maxPrice / 100) : MAX_SHEKELS)
  const [shekels, setShekels] = useState(initialShekels)

  const submit = (e: SyntheticEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.form?.requestSubmit()
  }

  return (
    <form method="GET" action="/" className="filter-form">
      <input type="hidden" name="category" value={category ?? ''} />

      <label className="price-f">
        עד <b>₪{shekels.toLocaleString('he-IL')}</b>
        <input
          type="range"
          name="maxPrice"
          min={MIN_SHEKELS}
          max={MAX_SHEKELS}
          value={shekels}
          onChange={(e) => setShekels(Number(e.currentTarget.value))}
          onMouseUp={submit}
          onTouchEnd={submit}
          onKeyUp={submit}
        />
      </label>

      <span className="select-wrap">
        <select name="sort" defaultValue={sort} className="chip select-chip" onChange={submit}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <svg className="select-chevron" width="11" height="7" viewBox="0 0 11 7" aria-hidden="true">
          <path d="M1 1l4.5 4.5L10 1" stroke="#8C837B" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </span>

      <button type="submit" className="chip">
        עדכן
      </button>
    </form>
  )
}
