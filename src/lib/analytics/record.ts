import { cookies, headers } from 'next/headers'
import { EventKind } from '@prisma/client'
import { db } from '@/lib/db'
import { VISITOR_COOKIE, isBot, readVisitorId } from './visitor'

/**
 * Records one thing a visitor did, and never, under any circumstance, breaks
 * the page that called it.
 *
 * That last part is the whole contract. Every call site is a server component
 * rendering a page a buyer is waiting for, and an analytics row is worth
 * nothing next to the shop being up: a failed insert, a database blip, a
 * missing table on a half-applied migration all cost a log line and no more.
 *
 * Two things are dropped silently and on purpose:
 *
 *   - a request with no valid visitor cookie. Middleware sets one on every
 *     public page, so the only requests without one are the ones that do not
 *     keep cookies — which are not people.
 *   - anything that looks like a bot. `isBot` explains why this matters more
 *     here than it looks: the shop's own WhatsApp link previews fetch the
 *     pages they preview.
 */
export async function record(kind: EventKind, itemId?: string): Promise<void> {
  try {
    const [jar, head] = await Promise.all([cookies(), headers()])

    const visitorId = readVisitorId(jar.get(VISITOR_COOKIE)?.value)
    if (visitorId === null) return
    if (isBot(head.get('user-agent'))) return

    await db.event.create({ data: { visitorId, kind, itemId: itemId ?? null } })
  } catch (err) {
    console.error('[analytics] could not record', kind, err)
  }
}
