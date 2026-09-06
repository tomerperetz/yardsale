import { describe, it, expect } from 'vitest'
import { newOrderCode, newOrderToken } from '@/lib/orders/codes'

describe('newOrderCode', () => {
  it('is short and typeable into a BIT note', () => {
    expect(newOrderCode()).toMatch(/^YS-\d{4}$/)
  })

  it('varies', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newOrderCode()))
    expect(seen.size).toBeGreaterThan(100)
  })
})

describe('newOrderToken', () => {
  it('is 22 url-safe characters', () => {
    expect(newOrderToken()).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('is unguessable — no collisions across many draws', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => newOrderToken()))
    expect(seen.size).toBe(2000)
  })
})
