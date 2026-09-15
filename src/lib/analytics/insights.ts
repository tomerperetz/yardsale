import { EventKind } from '@prisma/client'
import { db } from '@/lib/db'

/**
 * What the seller is shown about their own traffic.
 *
 * Two questions, and they are different questions: how many people came, and
 * what did they look at. The first is a count of distinct visitors; the second
 * is per item, and is the one that changes what the seller does — the thing
 * forty people opened and nobody put in a cart is priced wrong, and the thing
 * nobody opened at all has a bad photograph.
 */

/** The windows offered, in days. `null` means the whole history. */
export type Window = 7 | 30 | null

export function since(window: Window, now: Date = new Date()): Date | null {
  if (window === null) return null
  return new Date(now.getTime() - window * 24 * 60 * 60 * 1000)
}

export type Totals = {
  visitors: number
  shopViews: number
  itemViews: number
  addsToCart: number
}

/**
 * The headline numbers.
 *
 * `visitors` counts distinct visitor ids across every kind of event, not just
 * shop views: someone who opens an item link from WhatsApp and never sees the
 * grid is a person who came.
 */
export async function totals(window: Window, now: Date = new Date()): Promise<Totals> {
  const from = since(window, now)
  const where = from === null ? {} : { createdAt: { gte: from } }

  const [visitors, shopViews, itemViews, addsToCart] = await Promise.all([
    db.event
      .groupBy({ by: ['visitorId'], where })
      .then((rows) => rows.length),
    db.event.count({ where: { ...where, kind: EventKind.VIEW_SHOP } }),
    db.event.count({ where: { ...where, kind: EventKind.VIEW_ITEM } }),
    db.event.count({ where: { ...where, kind: EventKind.ADD_TO_CART } }),
  ])

  return { visitors, shopViews, itemViews, addsToCart }
}

export type ItemInterest = {
  itemId: string
  views: number
  /** Distinct browsers that opened it — the honest version of "how popular". */
  viewers: number
  addsToCart: number
}

type InterestRow = { itemId: string; views: bigint; viewers: bigint; adds: bigint }

/**
 * Per item: how many times it was opened, by how many different people, and
 * how many of them put it in a cart.
 *
 * Raw SQL for one reason: `COUNT(DISTINCT "visitorId")` per group, which
 * Prisma's `groupBy` cannot express. Both counts in one pass rather than two
 * queries and a join in JavaScript.
 *
 * `views` and `viewers` are both reported because they disagree in the way
 * that matters: eighty views from three people is three people who cannot
 * decide, and three views from three people is three people who looked once.
 */
export async function itemInterest(window: Window, now: Date = new Date()): Promise<ItemInterest[]> {
  const from = since(window, now)

  const rows = await db.$queryRawUnsafe<InterestRow[]>(
    `SELECT "itemId",
            COUNT(*) FILTER (WHERE "kind" = 'VIEW_ITEM')                       AS views,
            COUNT(DISTINCT "visitorId") FILTER (WHERE "kind" = 'VIEW_ITEM')    AS viewers,
            COUNT(*) FILTER (WHERE "kind" = 'ADD_TO_CART')                     AS adds
       FROM "Event"
      WHERE "itemId" IS NOT NULL
        ${from === null ? '' : 'AND "createdAt" >= $1'}
      GROUP BY "itemId"`,
    ...(from === null ? [] : [from]),
  )

  // bigint out of Postgres' count(): it cannot survive being handed to a
  // client component, and nothing here is anywhere near 2^53.
  return rows.map((row) => ({
    itemId: row.itemId,
    views: Number(row.views),
    viewers: Number(row.viewers),
    addsToCart: Number(row.adds),
  }))
}

/**
 * Daily distinct visitors, oldest first, with a row for every day in the
 * window — including the ones nobody came.
 *
 * The empty days are the point. A chart that silently skips them draws a
 * quiet week as a straight line between two busy ones.
 */
export async function visitorsByDay(days: number, now: Date = new Date()): Promise<{ day: string; visitors: number }[]> {
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  from.setUTCHours(0, 0, 0, 0)

  const rows = await db.$queryRawUnsafe<{ day: Date; visitors: bigint }[]>(
    `SELECT date_trunc('day', "createdAt") AS day, COUNT(DISTINCT "visitorId") AS visitors
       FROM "Event"
      WHERE "createdAt" >= $1
      GROUP BY 1
      ORDER BY 1`,
    from,
  )

  const counted = new Map(rows.map((row) => [row.day.toISOString().slice(0, 10), Number(row.visitors)]))
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(from.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    return { day, visitors: counted.get(day) ?? 0 }
  })
}
