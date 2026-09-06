import { randomBytes, randomInt } from 'node:crypto'

/**
 * Short, human-typeable, and therefore GUESSABLE. It is a payment reference only —
 * it must never grant access to anything. Use newOrderToken for URLs.
 */
export function newOrderCode(): string {
  return `YS-${String(randomInt(1000, 10000))}`
}

/** Unguessable. This is what appears in /pay/<token> and /o/<token>. */
export function newOrderToken(): string {
  return randomBytes(16).toString('base64url').slice(0, 22)
}
