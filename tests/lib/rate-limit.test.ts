import { describe, it, expect, beforeEach } from 'vitest'
import { hit, __resetRateLimit, __rateLimitKeyCount } from '@/lib/rate-limit'

beforeEach(() => __resetRateLimit())

describe('hit', () => {
  it('allows the first ten attempts', () => {
    for (let i = 0; i < 10; i++) expect(hit('1.2.3.4', 1000).allowed).toBe(true)
  })

  it('blocks the eleventh', () => {
    for (let i = 0; i < 10; i++) hit('1.2.3.4', 1000)
    const r = hit('1.2.3.4', 1000)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterMs).toBeGreaterThan(0)
  })

  it('tracks keys independently', () => {
    for (let i = 0; i < 10; i++) hit('1.2.3.4', 1000)
    expect(hit('5.6.7.8', 1000).allowed).toBe(true)
  })

  it('forgets attempts once the window has slid past', () => {
    for (let i = 0; i < 10; i++) hit('1.2.3.4', 1000)
    expect(hit('1.2.3.4', 1000 + 15 * 60_000 + 1).allowed).toBe(true)
  })

  it('exhausts the global budget across six distinct keys and blocks a seventh', () => {
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 10; i++) expect(hit(`ip-${k}`, 1000).allowed).toBe(true)
    }
    const r = hit('ip-6', 1000)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterMs).toBeGreaterThan(0)
  })

  it('slides the global window so a fresh key is allowed again once it passes', () => {
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 10; i++) hit(`ip-${k}`, 1000)
    }
    expect(hit('ip-6', 1000).allowed).toBe(false)
    expect(hit('ip-6', 1000 + 15 * 60_000 + 1).allowed).toBe(true)
  })

  it('keeps the key map bounded once distinct stale keys pile up past the cap', () => {
    let now = 1000
    for (let w = 0; w < 25; w++) {
      for (let i = 0; i < 50; i++) hit(`w${w}-k${i}`, now)
      now += 15 * 60_000 + 1
    }
    expect(__rateLimitKeyCount()).toBeLessThanOrEqual(1000)
  })
})
