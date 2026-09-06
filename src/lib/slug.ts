import { randomBytes } from 'node:crypto'

const MAX_NAME_CHARS = 80

/** Six lowercase base36 characters, appended to every slug to guarantee uniqueness. */
export function randomSuffix(): string {
  return Array.from(randomBytes(6))
    .map((b) => (b % 36).toString(36))
    .join('')
}

/**
 * Hebrew characters are legal in a URL path and browsers percent-encode them,
 * so the slug stays readable when pasted into WhatsApp.
 */
export function hebrewSlug(name: string, suffix: string): string {
  const body = name
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_NAME_CHARS)
    .replace(/-$/, '')

  return body ? `${body}-${suffix}` : suffix
}

/**
 * Dynamic route segments arrive at a route as whatever the request's raw
 * path contained — Next does not decode `params` itself. A `hebrewSlug` is
 * legal, human-readable UTF-8 in the URL path, but browsers percent-encode
 * it when they issue the request, so the value a route sees is
 * `%D7%A1%D7%A4%D7%94-...`, not `ספה-...`, and a lookup against the stored
 * (decoded) slug misses every time — see task-14 fix round 2.
 *
 * Decoding a plain ASCII slug (no percent-encoding present) is a no-op, so
 * this is safe to call unconditionally. A malformed escape (e.g. a lone `%`
 * not followed by two hex digits) makes `decodeURIComponent` throw — caught
 * here and returned as-is rather than corrupting or 500ing on it. Legal
 * slugs never contain a literal `%` (`hebrewSlug` maps every non-letter,
 * non-number character to `-`), so this path only matters for garbage input,
 * which should end up a 404, not a crash.
 */
export function decodeSlugParam(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
