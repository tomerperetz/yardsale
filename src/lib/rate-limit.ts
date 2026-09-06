const WINDOW_MS = 15 * 60_000
const MAX_ATTEMPTS = 10
const MAX_GLOBAL_ATTEMPTS = 60
const MAX_KEYS = 1000

const attempts = new Map<string, number[]>()
let globalAttempts: number[] = []

/**
 * In-memory sliding window, per key (e.g. per IP) plus a global backstop.
 *
 * The key comes from a client-controlled header (x-forwarded-for), so an
 * attacker can rotate it to get a fresh per-key bucket every request. The
 * global backstop caps total attempts across ALL keys in the window, so
 * header-rotation is throttled rather than unlimited. The key map is pruned
 * once it grows past MAX_KEYS so rotating keys can't grow it unboundedly
 * either — the global backstop still holds after a prune, so clearing stale
 * keys can't be used to bypass the limit.
 */
export function hit(key: string, now: number = Date.now()): { allowed: boolean; retryAfterMs: number } {
  globalAttempts = globalAttempts.filter((t) => now - t < WINDOW_MS)
  if (globalAttempts.length >= MAX_GLOBAL_ATTEMPTS) {
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - globalAttempts[0]) }
  }

  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS)

  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(key, recent)
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - recent[0]) }
  }

  recent.push(now)
  attempts.set(key, recent)
  globalAttempts.push(now)

  if (attempts.size > MAX_KEYS) {
    for (const [k, times] of attempts) {
      if (times.every((t) => now - t >= WINDOW_MS)) attempts.delete(k)
    }
    if (attempts.size > MAX_KEYS) attempts.clear()
  }

  return { allowed: true, retryAfterMs: 0 }
}

export function __resetRateLimit() {
  attempts.clear()
  globalAttempts = []
}

/** Test-only: the number of distinct keys currently tracked. */
export function __rateLimitKeyCount(): number {
  return attempts.size
}
