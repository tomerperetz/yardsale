import { createHmac, timingSafeEqual } from 'node:crypto'
import { verify } from '@node-rs/argon2'

export const SESSION_COOKIE = 'ys_admin'
const MAX_AGE_MS = 30 * 86_400_000

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET is not set')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function signSession(issuedAt: number = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ iat: issuedAt })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function readSession(raw: string | undefined, now: number = Date.now()): boolean {
  if (!raw) return false
  const parts = raw.split('.')
  if (parts.length !== 2) return false
  const [payload, sig] = parts

  const expected = Buffer.from(sign(payload))
  const actual = Buffer.from(sig)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false

  try {
    const { iat } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { iat: number }
    return typeof iat === 'number' && now - iat < MAX_AGE_MS && iat <= now
  } catch {
    return false
  }
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const hash = process.env.ADMIN_PASSWORD_HASH
  if (!hash) throw new Error('ADMIN_PASSWORD_HASH is not set')
  // A well-formed argon2id hash always starts with $argon2. Anything else is
  // almost certainly a deploy misconfiguration — most commonly Next.js's env
  // loader interpolating $VAR syntax and mangling an unescaped hash — so fail
  // loud here rather than silently rejecting every password forever.
  if (!hash.startsWith('$argon2')) {
    throw new Error(
      'ADMIN_PASSWORD_HASH looks corrupted (does not start with "$argon2"). If it was pasted into ' +
        '.env, escape every "$" as "\\$" — Next.js interpolates $VAR syntax in env files.',
    )
  }
  try {
    return await verify(hash, password)
  } catch {
    return false
  }
}
