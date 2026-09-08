const WINDOW_MS = 15 * 60_000
const MAX_ATTEMPTS = 10
const MAX_KEYS = 1000

/**
 * The global ceiling for each namespace, per window. Deliberately unequal:
 * the two things being limited have nothing in common but a mechanism.
 *
 * `login` is one human typing one password. 60 in fifteen minutes is far more
 * than the seller will ever need and still bounds a header-rotating attacker
 * to 240 argon2id guesses an hour. It is left where it has always been:
 * tightening it would risk the very thing this split exists to prevent —
 * locking the seller out of their own shop mid-sale.
 *
 * `checkout` is every buyer at once. A WhatsApp blast can put a hundred people
 * on the shop inside a minute, and the losers of a race retry; 300 is roughly
 * twenty attempts a minute sustained, an order of magnitude more than a
 * one-household sale of ~40 items can genuinely produce. Note what this
 * ceiling is and is not for: it bounds wasted server work, not how much of the
 * shop one caller can hold — the 20-item cap in reserveItems, a finite
 * catalogue, and the 15-minute hold already do that.
 *
 * Adding a namespace here is the only way to create one, so the namespace map
 * below is bounded by this object and cannot grow at runtime.
 */
const GLOBAL_CEILINGS = {
  login: 60,
  checkout: 300,
  /**
   * `import` is the seller dropping a sale's worth of photos at /api/import.
   * It is authenticated, so this is not the thing keeping strangers out — the
   * middleware is. It bounds how much sharp work one caller can queue, and it
   * is its own namespace so that a big import cannot spend the budget the
   * seller needs to sign back in, which is exactly what the split exists for.
   * 60 requests a window is many times a real import: one drop is one request.
   */
  import: 60,
  /** Anything that has not asked for a budget of its own. */
  default: 60,
} as const

export type RateLimitNamespace = keyof typeof GLOBAL_CEILINGS

const attempts = new Map<string, number[]>()
const globalAttempts = new Map<RateLimitNamespace, number[]>()

/** Unknown namespaces fall into `default` rather than minting a bucket. */
function bucketFor(namespace: string): RateLimitNamespace {
  return namespace in GLOBAL_CEILINGS ? (namespace as RateLimitNamespace) : 'default'
}

/**
 * In-memory sliding window, per key (e.g. per IP) plus a global backstop —
 * both scoped to a namespace.
 *
 * The key comes from a client-controlled header (x-forwarded-for), so an
 * attacker can rotate it to get a fresh per-key bucket every request. The
 * global backstop caps total attempts across ALL keys in the window, so
 * header-rotation is throttled rather than unlimited. The key map is pruned
 * once it grows past MAX_KEYS so rotating keys can't grow it unboundedly
 * either — the global backstop still holds after a prune, so clearing stale
 * keys can't be used to bypass the limit.
 *
 * The namespace is what stops one caller's traffic starving another's: with a
 * single shared backstop, a burst of buyers at checkout could spend the budget
 * that /admin/login needs and lock the seller out of their own admin for a
 * whole window — during exactly the fifteen minutes when orders are arriving
 * and payments need confirming. Buyers and the seller now have independent
 * global ceilings and cannot reach each other's.
 */
export function hit(
  key: string,
  now: number = Date.now(),
  namespace: RateLimitNamespace = 'default',
): { allowed: boolean; retryAfterMs: number } {
  const ns = bucketFor(namespace)

  const globals = (globalAttempts.get(ns) ?? []).filter((t) => now - t < WINDOW_MS)
  globalAttempts.set(ns, globals)
  if (globals.length >= GLOBAL_CEILINGS[ns]) {
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - globals[0]) }
  }

  // Namespaced, so the same IP gets an independent per-key budget for each —
  // a buyer who has used up their checkout attempts has not used up anything
  // else, and vice versa. NUL separates the two halves because it can occur in
  // neither a namespace nor an address, so no two pairs share a map key.
  const mapKey = `${ns}\u0000${key}`
  const recent = (attempts.get(mapKey) ?? []).filter((t) => now - t < WINDOW_MS)

  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(mapKey, recent)
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - recent[0]) }
  }

  recent.push(now)
  attempts.set(mapKey, recent)
  globals.push(now)

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
  globalAttempts.clear()
}

/** Test-only: the number of distinct keys currently tracked, across all namespaces. */
export function __rateLimitKeyCount(): number {
  return attempts.size
}
