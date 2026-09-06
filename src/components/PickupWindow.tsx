import { Range } from '@/components/Range'

const monthFormatter = new Intl.DateTimeFormat('he-IL', { month: 'long', timeZone: 'UTC' })

/**
 * Renders a pickup window's day(s), deriving the month name(s) from the
 * data instead of a hardcoded string — a window in October must not render
 * as "בספטמבר", and a window crossing a month boundary needs each day next
 * to its own month name.
 *
 * `from`/`to` are `@db.Date` columns — always read with UTC accessors; a
 * local-time accessor can shift the calendar day.
 */
export function PickupWindow({ from, to }: { from: Date; to: Date }) {
  const dayFrom = from.getUTCDate()
  const dayTo = to.getUTCDate()
  const monthFrom = monthFormatter.format(from)
  const monthTo = monthFormatter.format(to)
  const sameMonth = from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()

  if (sameMonth && dayFrom === dayTo) {
    return (
      <>
        {dayFrom} ב{monthFrom}
      </>
    )
  }

  if (sameMonth) {
    return (
      <>
        <Range from={dayFrom} to={dayTo} /> ב{monthFrom}
      </>
    )
  }

  // Different months: no <Range> isolate here — each number sits directly
  // beside its own Hebrew month name, so every neutral separator already
  // sits between strongly-directional runs and bidi resolves correctly.
  return (
    <>
      {dayFrom} ב{monthFrom} – {dayTo} ב{monthTo}
    </>
  )
}
