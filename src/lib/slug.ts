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
