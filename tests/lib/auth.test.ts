import { describe, it, expect, beforeEach } from 'vitest'
import { signSession, readSession } from '@/lib/auth'

const DAY = 86_400_000

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-secret-value-at-least-32-chars-long'
})

describe('session cookie', () => {
  it('round-trips a freshly signed session', () => {
    const now = 1_800_000_000_000
    expect(readSession(signSession(now), now + 1000)).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const now = 1_800_000_000_000
    const [payload, sig] = signSession(now).split('.')
    const forged = Buffer.from(JSON.stringify({ iat: now + DAY * 365 })).toString('base64url')
    expect(readSession(`${forged}.${sig}`, now)).toBe(false)
  })

  it('rejects a cookie signed with a different secret', () => {
    const now = 1_800_000_000_000
    const cookie = signSession(now)
    process.env.SESSION_SECRET = 'a-completely-different-secret-value-here'
    expect(readSession(cookie, now)).toBe(false)
  })

  it('rejects a session older than 30 days', () => {
    const now = 1_800_000_000_000
    expect(readSession(signSession(now), now + 31 * DAY)).toBe(false)
  })

  it('rejects undefined and garbage', () => {
    expect(readSession(undefined)).toBe(false)
    expect(readSession('nonsense')).toBe(false)
    expect(readSession('a.b.c')).toBe(false)
  })
})
