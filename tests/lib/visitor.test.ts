import { describe, it, expect } from 'vitest'
import { isBot, newVisitorId, readVisitorId } from '@/lib/analytics/visitor'

describe('newVisitorId', () => {
  it('is 128 bits of hex', () => {
    expect(newVisitorId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, newVisitorId))
    expect(ids.size).toBe(500)
  })
})

describe('readVisitorId', () => {
  it('accepts an id it minted itself', () => {
    const id = newVisitorId()
    expect(readVisitorId(id)).toBe(id)
  })

  it('treats a missing cookie as no visitor', () => {
    expect(readVisitorId(undefined)).toBeNull()
  })

  it('refuses anything that is not exactly 32 hex characters', () => {
    // The cookie is client-controlled and this value ends up in a database
    // column and a GROUP BY. Nothing else may reach either.
    for (const bad of ['', 'abc', 'A'.repeat(32), 'g'.repeat(32), '0'.repeat(31), '0'.repeat(33), "'; DROP TABLE"]) {
      expect(readVisitorId(bad)).toBeNull()
    }
  })
})

describe('isBot', () => {
  it.each([
    ['WhatsApp/2.23.20.0', 'a WhatsApp link preview'],
    ['facebookexternalhit/1.1', 'a Facebook preview'],
    ['TelegramBot (like TwitterBot)', 'Telegram'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'Googlebot'],
    ['curl/8.4.0', 'curl'],
    ['python-requests/2.31.0', 'a script'],
    ['Mozilla/5.0 HeadlessChrome/120', 'headless chrome'],
  ])('catches %s — %s', (ua) => {
    expect(isBot(ua)).toBe(true)
  })

  it('catches WhatsApp specifically, which is the one that would skew this shop', () => {
    // The shop's own link previews fetch the page they preview. Without this,
    // every share the seller makes reads as a person opening that item.
    expect(isBot('WhatsApp/2.2412.1 A')).toBe(true)
  })

  it('treats a request with no user agent as not a person', () => {
    expect(isBot(null)).toBe(true)
    expect(isBot('')).toBe(true)
    expect(isBot('   ')).toBe(true)
  })

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  ])('lets a real phone or desktop browser through', (ua) => {
    expect(isBot(ua)).toBe(false)
  })
})
