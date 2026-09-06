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

const WINDOW_MS = 15 * 60_000

/** Spends `count` attempts in `namespace`, ten per key, from distinct keys. */
function drain(namespace: 'login' | 'checkout', count: number, now: number) {
  for (let i = 0; i < count; i++) {
    expect(hit(`ip-${Math.floor(i / 10)}`, now, namespace).allowed).toBe(true)
  }
}

/**
 * The two things being limited share only a mechanism. A burst of buyers at
 * checkout must never be able to spend the budget the seller needs to sign in
 * and confirm payments — that would turn a defence against abuse into a way
 * for ordinary traffic to lock the shop's owner out of it mid-sale.
 */
describe('hit namespaces', () => {
  it('lets the seller in even after buyers have exhausted the checkout budget', () => {
    drain('checkout', 300, 1000)

    expect(hit('ip-30', 1000, 'checkout').allowed).toBe(false)
    expect(hit('ip-30', 1000, 'login').allowed).toBe(true)
  })

  it('does not let login traffic spend the buyers budget either', () => {
    drain('login', 60, 1000)

    expect(hit('ip-6', 1000, 'login').allowed).toBe(false)
    expect(hit('ip-6', 1000, 'checkout').allowed).toBe(true)
  })

  it('slides each namespace global window on its own', () => {
    drain('login', 60, 1000)
    expect(hit('fresh', 1000, 'login').allowed).toBe(false)
    expect(hit('fresh', 1000 + WINDOW_MS + 1, 'login').allowed).toBe(true)

    drain('checkout', 300, 1000)
    expect(hit('fresh', 1000, 'checkout').allowed).toBe(false)
    expect(hit('fresh', 1000 + WINDOW_MS + 1, 'checkout').allowed).toBe(true)
  })

  it('gives one caller an independent per-key allowance in each namespace', () => {
    for (let i = 0; i < 10; i++) expect(hit('1.2.3.4', 1000, 'checkout').allowed).toBe(true)

    expect(hit('1.2.3.4', 1000, 'checkout').allowed).toBe(false)
    expect(hit('1.2.3.4', 1000, 'login').allowed).toBe(true)
  })

  it('counts an unknown namespace against the default budget rather than minting one', () => {
    // Namespaces exist only in GLOBAL_CEILINGS, so the map cannot grow at
    // runtime however a JS caller mistypes one.
    const unknown = 'nonsense' as 'login'
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 10; i++) hit(`ip-${k}`, 1000, unknown)
    }

    expect(hit('ip-6', 1000, unknown).allowed).toBe(false)
    expect(hit('ip-6', 1000).allowed).toBe(false)
    expect(hit('ip-6', 1000, 'login').allowed).toBe(true)
  })

  it('clears every namespace on reset', () => {
    drain('login', 60, 1000)
    drain('checkout', 300, 1000)
    expect(hit('fresh', 1000, 'login').allowed).toBe(false)
    expect(hit('fresh', 1000, 'checkout').allowed).toBe(false)

    __resetRateLimit()

    expect(hit('fresh', 1000, 'login').allowed).toBe(true)
    expect(hit('fresh', 1000, 'checkout').allowed).toBe(true)
    expect(__rateLimitKeyCount()).toBe(2)
  })
})
