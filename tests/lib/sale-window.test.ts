import { describe, it, expect } from 'vitest'
import { saleWindow, saleWindowInputs, saleWindowEnded, DEFAULT_SALE_DAYS } from '@/lib/sale-window'
import { utcDate } from '@/lib/dates'

const NOW = new Date('2026-09-15T21:40:00Z')

/** A Settings row that has never had a sale window set. */
const unset = { saleFrom: null, saleTo: null }

/** The window the seller actually typed: today through the 28th. */
const set = { saleFrom: utcDate(2026, 9, 15), saleTo: utcDate(2026, 9, 28) }

describe('saleWindow', () => {
  it('returns the window the seller configured, untouched', () => {
    expect(saleWindow(set, NOW)).toEqual({ from: utcDate(2026, 9, 15), to: utcDate(2026, 9, 28) })
  })

  it('falls back to today → today+14 when nothing is set', () => {
    const { from, to } = saleWindow(unset, NOW)
    expect(from).toEqual(utcDate(2026, 9, 15))
    expect(to).toEqual(utcDate(2026, 9, 29))
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(DEFAULT_SALE_DAYS)
  })

  it('treats a row holding only one end as unset, rather than inventing the other', () => {
    // The save path writes both or neither. If a half-window ever reached the
    // database anyway, guessing the missing end would put a date nobody chose
    // onto every item created afterwards.
    expect(saleWindow({ saleFrom: utcDate(2026, 9, 1), saleTo: null }, NOW).from).toEqual(utcDate(2026, 9, 15))
    expect(saleWindow({ saleFrom: null, saleTo: utcDate(2026, 9, 28) }, NOW).to).toEqual(utcDate(2026, 9, 29))
  })

  it('never opens a new item in the past, even from a window that has ended', () => {
    // The fallback is what protects an unconfigured shop; a configured one is
    // the seller's own choice, and `saleWindowEnded` is what tells them it has
    // run out. This asserts the half that is automatic.
    const { from } = saleWindow(unset, new Date('2026-12-31T23:59:59Z'))
    expect(from).toEqual(utcDate(2026, 12, 31))
  })

  it('reads the day off UTC, not the local clock', () => {
    // 23:40 UTC is already the 16th in Israel and still the 15th in New York.
    // The column is @db.Date at UTC midnight, so the answer must not move.
    expect(saleWindow(unset, new Date('2026-09-15T23:40:00Z')).from).toEqual(utcDate(2026, 9, 15))
  })
})

describe('saleWindowInputs', () => {
  it('renders both ends as the <input type="date"> values that show them', () => {
    expect(saleWindowInputs(set, NOW)).toEqual({ from: '2026-09-15', to: '2026-09-28' })
  })

  it('shows the fallback the same way, so a first-run form is never blank-dated', () => {
    expect(saleWindowInputs(unset, NOW)).toEqual({ from: '2026-09-15', to: '2026-09-29' })
  })
})

describe('saleWindowEnded', () => {
  it('is true once the last day of the sale has passed', () => {
    expect(saleWindowEnded({ saleFrom: utcDate(2026, 9, 1), saleTo: utcDate(2026, 9, 13) }, NOW)).toBe(true)
  })

  it('is false for the whole of the last day', () => {
    // A seller collecting on the 28th is still selling at 21:40 on the 28th.
    const lastDay = new Date('2026-09-28T21:40:00Z')
    expect(saleWindowEnded(set, lastDay)).toBe(false)
  })

  it('is never true for a window nobody set', () => {
    expect(saleWindowEnded(unset, NOW)).toBe(false)
    expect(saleWindowEnded({ saleFrom: utcDate(2020, 1, 1), saleTo: null }, NOW)).toBe(false)
  })
})
