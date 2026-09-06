import { describe, it, expect, beforeEach } from 'vitest'
import { hit, __resetRateLimit } from '@/lib/rate-limit'

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
})
