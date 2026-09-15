import type { Settings } from '@prisma/client'
import { startOfUtcDay, toDateInput } from '@/lib/dates'

/**
 * The sale's collection window — the days the seller is home to hand things
 * over — read off `Settings`.
 *
 * This is where a new item's pickup window comes from. It used to come from
 * the seller's most recent item, which is how one stale window propagated
 * across every later import: nineteen of twenty live items ended up telling
 * buyers to collect during a week that had already passed, because each new
 * item inherited the one before it and nothing ever re-asked the seller.
 * Settings is a single place they can fix, and fixing it there changes what
 * every future item opens with.
 *
 * Kept import-free (no db, no Prisma client) so a component test can call it.
 */

/** What an unset window falls back to: today, through a fortnight from today. */
export const DEFAULT_SALE_DAYS = 14

const DAY_MS = 86_400_000

export type SaleWindow = { from: Date; to: Date }

type SaleDates = Pick<Settings, 'saleFrom' | 'saleTo'>

/**
 * The configured window, or today → today+14 when the seller has not set one.
 *
 * A row holding only one end is treated as unset rather than half-used: the
 * save path writes both or neither (see `saveSettingsAction`), and half a
 * window is not a window — guessing the missing end would put a date on real
 * items that nobody chose.
 *
 * Both ends are returned as the UTC midnights the `@db.Date` columns hold, so
 * a caller can write them straight onto an item.
 */
export function saleWindow(settings: SaleDates, now: Date = new Date()): SaleWindow {
  if (settings.saleFrom !== null && settings.saleTo !== null) {
    return { from: settings.saleFrom, to: settings.saleTo }
  }
  const from = startOfUtcDay(now)
  return { from, to: new Date(from.getTime() + DEFAULT_SALE_DAYS * DAY_MS) }
}

/** The same window as the pair of `<input type="date">` values a form shows. */
export function saleWindowInputs(settings: SaleDates, now: Date = new Date()): { from: string; to: string } {
  const window = saleWindow(settings, now)
  return { from: toDateInput(window.from), to: toDateInput(window.to) }
}

/**
 * Whether the configured window has already ended — the exact state that put
 * a past week on every item in the shop.
 *
 * Only ever true for a window the seller actually set: an unset one falls back
 * to today and cannot be in the past. Compared at UTC midnight, so the last
 * day of the sale is still "not ended" for the whole of that day.
 */
export function saleWindowEnded(settings: SaleDates, now: Date = new Date()): boolean {
  return settings.saleTo !== null && settings.saleTo.getTime() < startOfUtcDay(now).getTime()
}
