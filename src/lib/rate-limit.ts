const WINDOW_MS = 15 * 60_000
const MAX_KEYS = 1000

/**
 * The two ceilings each namespace gets per window: `perKey` bounds one caller
 * (one IP), `global` bounds every caller of that namespace together.
 * Deliberately unequal, in both columns: the things being limited have nothing
 * in common but a mechanism.
 *
 * `login` is one human typing one password. Ten guesses per IP, and 60 in
 * fifteen minutes in total — far more than the seller will ever need, and
 * still bounding a header-rotating attacker to 240 argon2id guesses an hour.
 * It is left where it has always been: tightening it would risk the very thing
 * this split exists to prevent — locking the seller out of their shop mid-sale.
 *
 * `checkout` is every buyer at once. A WhatsApp blast can put a hundred people
 * on the shop inside a minute, and the losers of a race retry; 300 is roughly
 * twenty attempts a minute sustained, an order of magnitude more than a
 * one-household sale of ~40 items can genuinely produce. Note what this
 * ceiling is and is not for: it bounds wasted server work, not how much of the
 * shop one caller can hold — the 20-item cap in reserveItems, a finite
 * catalogue, and the 15-minute hold already do that.
 *
 * `import` is the seller dropping a sale's worth of photos at /api/import. It
 * is authenticated, so this is not what keeps strangers out — the middleware
 * is; it bounds how much sharp work one caller can queue. Its per-key ceiling
 * is the one number here that is NOT ten, and cannot be: the client uploads
 * six photos per request (spec §7.1), so a full 60-photo drop is ten requests,
 * and ten would be spent exactly by one drop with nothing left for a single
 * chunk retry. 40 is four full drops in a quarter of an hour, or one drop and
 * thirty retries — comfortably past what a real import needs, and still an
 * order of magnitude off what it would take to matter.
 *
 * Adding a namespace here is the only way to create one, so the namespace map
 * below is bounded by this object and cannot grow at runtime — and both of a
 * namespace's ceilings are declared in the same place, so a new one cannot
 * arrive with half a budget.
 */
const CEILINGS = {
  login: { perKey: 10, global: 60 },
  checkout: { perKey: 10, global: 300 },
  import: { perKey: 40, global: 60 },
  /** Anything that has not asked for a budget of its own. */
  default: { perKey: 10, global: 60 },
} as const

export type RateLimitNamespace = keyof typeof CEILINGS

const attempts = new Map<string, number[]>()
const globalAttempts = new Map<RateLimitNamespace, number[]>()

/** Unknown namespaces fall into `default` rather than minting a bucket. */
function bucketFor(namespace: string): RateLimitNamespace {
  return namespace in CEILINGS ? (namespace as RateLimitNamespace) : 'default'
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
 * ceilings, per key and global, and cannot reach each other's.
 */
export function hit(
  key: string,
  now: number = Date.now(),
  namespace: RateLimitNamespace = 'default',
): { allowed: boolean; retryAfterMs: number } {
  const ns = bucketFor(namespace)

  const globals = (globalAttempts.get(ns) ?? []).filter((t) => now - t < WINDOW_MS)
  globalAttempts.set(ns, globals)
  if (globals.length >= CEILINGS[ns].global) {
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - globals[0]) }
  }

  // Namespaced, so the same IP gets an independent per-key budget for each —
  // a buyer who has used up their checkout attempts has not used up anything
  // else, and vice versa. NUL separates the two halves because it can occur in
  // neither a namespace nor an address, so no two pairs share a map key.
  const mapKey = `${ns}\u0000${key}`
  const recent = (attempts.get(mapKey) ?? []).filter((t) => now - t < WINDOW_MS)

  if (recent.length >= CEILINGS[ns].perKey) {
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
