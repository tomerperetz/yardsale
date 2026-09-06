import { describe, it, expect } from 'vitest'
import { intersectPickupWindows, utcDate, eachDay } from '@/lib/dates'

const d = utcDate
const TODAY = d(2026, 9, 10)

describe('intersectPickupWindows', () => {
  it('returns the single window for a one-item cart', () => {
    const r = intersectPickupWindows([{ id: 'a', from: d(2026, 9, 12), to: d(2026, 9, 18) }], TODAY)
    expect(r).toEqual({ ok: true, from: d(2026, 9, 12), to: d(2026, 9, 18), startItemId: 'a', endItemId: 'a' })
  })

  it('narrows to the overlap of several windows', () => {
    const r = intersectPickupWindows(
      [
        { id: 'a', from: d(2026, 9, 12), to: d(2026, 9, 18) },
        { id: 'b', from: d(2026, 9, 14), to: d(2026, 9, 21) },
        { id: 'c', from: d(2026, 9, 10), to: d(2026, 9, 20) },
      ],
      TODAY,
    )
    expect(r).toMatchObject({ ok: true, from: d(2026, 9, 14), to: d(2026, 9, 18), startItemId: 'b', endItemId: 'a' })
  })

  it('accepts a single-day overlap', () => {
    const r = intersectPickupWindows(
      [
        { id: 'a', from: d(2026, 9, 12), to: d(2026, 9, 15) },
        { id: 'b', from: d(2026, 9, 15), to: d(2026, 9, 20) },
      ],
      TODAY,
    )
    expect(r).toMatchObject({ ok: true, from: d(2026, 9, 15), to: d(2026, 9, 15) })
  })

  it('reports the conflicting pair when there is no overlap', () => {
    const r = intersectPickupWindows(
      [
        { id: 'a', from: d(2026, 9, 12), to: d(2026, 9, 14) },
        { id: 'b', from: d(2026, 9, 16), to: d(2026, 9, 20) },
      ],
      TODAY,
    )
    expect(r).toEqual({ ok: false, startItemId: 'b', endItemId: 'a' })
  })

  it('clamps a window that started in the past to today', () => {
    const r = intersectPickupWindows([{ id: 'a', from: d(2026, 9, 1), to: d(2026, 9, 18) }], TODAY)
    expect(r).toMatchObject({ ok: true, from: TODAY })
  })

  it('fails when the whole window is already in the past', () => {
    const r = intersectPickupWindows([{ id: 'a', from: d(2026, 9, 1), to: d(2026, 9, 5) }], TODAY)
    expect(r.ok).toBe(false)
  })

  it('fails on an empty cart', () => {
    expect(intersectPickupWindows([], TODAY).ok).toBe(false)
  })
})

describe('eachDay', () => {
  it('is inclusive of both ends', () => {
    expect(eachDay(d(2026, 9, 14), d(2026, 9, 18))).toHaveLength(5)
  })

  it('returns one day when from equals to', () => {
    expect(eachDay(d(2026, 9, 14), d(2026, 9, 14))).toEqual([d(2026, 9, 14)])
  })
})
