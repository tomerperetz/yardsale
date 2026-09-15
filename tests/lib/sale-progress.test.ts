import { describe, it, expect } from 'vitest'
import { percent } from '@/lib/admin/sale-progress'

describe('percent', () => {
  it('reads off the obvious fractions', () => {
    expect(percent(1, 2)).toBe(50)
    expect(percent(1, 4)).toBe(25)
    expect(percent(3, 4)).toBe(75)
  })

  it('is 0 for a shop with nothing in it, rather than NaN', () => {
    expect(percent(0, 0)).toBe(0)
    expect(percent(5, 0)).toBe(0)
  })

  it('never says 100% while something is still on the shelf', () => {
    // 199 of 200 rounds to 100, and a bar reading "100%" above two unsold
    // items is the one number here that would actually mislead the seller.
    expect(percent(199, 200)).toBe(99)
    expect(percent(999, 1000)).toBe(99)
  })

  it('says 100% only when everything has gone', () => {
    expect(percent(200, 200)).toBe(100)
    // Above the whole — a price cut after a sale — is still everything.
    expect(percent(201, 200)).toBe(100)
  })

  it('never rounds a first sale away to nothing', () => {
    // 1 of 500 rounds to 0. The seller who just made their first sale should
    // not open the screen to a bar that says none.
    expect(percent(1, 500)).toBe(1)
  })

  it('treats nothing sold as nothing sold', () => {
    expect(percent(0, 20)).toBe(0)
  })
})
