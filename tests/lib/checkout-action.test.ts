import { describe, it, expect, beforeEach, vi } from 'vitest'
import { __resetRateLimit } from '@/lib/rate-limit'

// The action reads the caller's IP through next/headers and, on success,
// redirects — both need a request context Next only provides while serving.
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

const valid = {
  itemIds: 'nonexistent-id',
  buyerName: 'מיכל אברהמי',
  buyerPhone: '0527418830',
  pickupSlot: 'AFTERNOON',
  pickupDate: '2026-09-15',
}

/**
 * Checkout is the only unauthenticated endpoint that changes item
 * availability, and item ids are public — they appear in every /img/<itemId>/…
 * URL. Without a limiter one caller can hold the shop RESERVED on repeat.
 */
describe('checkout rate limiting', () => {
  beforeEach(() => {
    __resetRateLimit()
  })

  it('throttles one caller after the per-key allowance, before doing any work', async () => {
    const { checkout } = await import('@/app/checkout/actions')

    const results = []
    for (let i = 0; i < 11; i++) results.push(await checkout({}, form({ ...valid, buyerName: '' })))

    // The first ten get as far as validation; the eleventh never does.
    expect(results.slice(0, 10).every((r) => r.error === 'צריך שם מלא.')).toBe(true)
    expect(results[10]).toEqual({ error: 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.' })
  })

  it('does not spend the seller login allowance for the same IP', async () => {
    const { checkout } = await import('@/app/checkout/actions')
    const { hit } = await import('@/lib/rate-limit')

    for (let i = 0; i < 11; i++) await checkout({}, form({ ...valid, buyerName: '' }))

    expect(hit('203.0.113.9').allowed).toBe(true)
  })
})
