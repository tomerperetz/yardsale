/**
 * Who a visitor is, as far as this shop is concerned.
 *
 * A random opaque id in a first-party cookie, and nothing else. Not an IP,
 * not a user agent hash, not a fingerprint: it says "the same browser came
 * back", which is the whole of what a unique-visitor count needs, and it is
 * the version of that question that cannot be turned into a person.
 *
 * Deliberately free of imports so both middleware and the server components
 * that read it use the same names and the same rules.
 */

export const VISITOR_COOKIE = 'ys_v'

/** A year. Long enough that a returning buyer is recognised across a sale. */
export const VISITOR_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

/** What a visitor id is allowed to look like — checked before anything is stored under it. */
const VISITOR_ID_RE = /^[0-9a-f]{32}$/

/**
 * 128 bits of randomness as hex.
 *
 * `crypto.getRandomValues` and not `Math.random`: this id is the key every
 * event in the shop is grouped by, and a predictable one would let anyone
 * write events attributed to somebody else's browser.
 */
export function newVisitorId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The id in a cookie value, or null.
 *
 * A value this does not recognise is treated as absent rather than trusted:
 * the cookie is client-controlled, and `visitorId` ends up in a database
 * column and in a GROUP BY. Nothing but 32 hex characters ever gets there.
 */
export function readVisitorId(raw: string | undefined): string | null {
  if (raw === undefined) return null
  return VISITOR_ID_RE.test(raw) ? raw : null
}

/**
 * Requests that are not people.
 *
 * This is not politeness about bots, it is the difference between a useful
 * number and a wrong one. Every WhatsApp share fetches the page it links to in
 * order to build its preview card — so the shop's own link previews, added the
 * same week as this, would otherwise register as a visitor reading an item
 * every time the seller shared a link.
 */
const BOT_RE =
  /bot|crawler|spider|crawling|facebookexternalhit|whatsapp|telegram|slackbot|twitterbot|discordbot|preview|embedly|pinterest|redditbot|applebot|bingpreview|headless|lighthouse|monitoring|uptime|curl|wget|python-requests|axios|node-fetch|go-http-client|postman/i

export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim() === '') return true
  return BOT_RE.test(userAgent)
}
