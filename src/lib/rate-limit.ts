const WINDOW_MS = 15 * 60_000
const MAX_ATTEMPTS = 10

const attempts = new Map<string, number[]>()

/** In-memory sliding window. One process, one seller — no shared store needed. */
export function hit(key: string, now: number = Date.now()): { allowed: boolean; retryAfterMs: number } {
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS)

  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(key, recent)
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - recent[0]) }
  }

  recent.push(now)
  attempts.set(key, recent)
  return { allowed: true, retryAfterMs: 0 }
}

export function __resetRateLimit() {
  attempts.clear()
}
