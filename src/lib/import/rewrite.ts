import { ItemStatus, type Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { aiEnabled, captionItem } from '@/lib/ai/client'
import type { AiFailure, AiResult, Caption } from '@/lib/ai/types'
import { readPhotoBytes } from './photo-bytes'

/**
 * Rewrites the descriptions of items that are already in the shop.
 *
 * The import's copy pass only ever ran on the way in, so the items listed
 * before it existed — and the ones written by the colder prompt that shipped
 * before 2026-09-15 — keep the descriptions they have. Some of them are not
 * descriptions at all: one live item's description is the name of its own
 * category, another's is its own name repeated.
 *
 * DESCRIPTIONS ONLY. Not the name, not the category, not the price. Those the
 * seller has chosen, buyers have seen, and orders have been placed against —
 * a bulk action that quietly renamed twenty listings and repriced them is not
 * a thing anyone can undo. The model is shown the same photographs and asked
 * the same question; only one field of its answer is kept.
 *
 * This is the only control in the app that spends money per row, and the three
 * guards below exist because of that, not for tidiness.
 */

/** How many model calls are in flight at once. */
const CONCURRENCY = 4

/**
 * How many items one press may rewrite.
 *
 * Guard one, and the reason is a wall clock rather than a budget. A caption
 * call takes ten to fifteen seconds; sixty items in a single server action is
 * three to four minutes in one request, which Railway's edge and most proxies
 * cut long before it finishes. The seller then sees "try again" for a call
 * that is still running and still billing, presses it, and buys every
 * description twice. Twelve is three rounds of four — well inside any
 * proxy — and the press is repeatable because of the column below.
 */
const BATCH_LIMIT = 12

/**
 * Guard two: one rewrite at a time, per server process.
 *
 * Module scope, which is exactly as far as it needs to reach — this app runs
 * as a single container, and the failure it prevents is one seller
 * double-pressing a button whose first press has not answered yet. A row lock
 * would be the answer for a fleet; this is not a fleet.
 */
let inFlight = false

/**
 * What a rewrite is allowed to touch: anything with a photograph to look at,
 * that a buyer might still read, that no model has written yet.
 *
 * SOLD is out because its listing is history — the money has moved, the item
 * is gone, and rewriting its description spends credit on something nobody
 * will read. DRAFT is out because it is mid-import: its description was
 * written by this same prompt from these same photographs minutes ago, and
 * the review screen holds the seller's copy in component state and writes it
 * back on publish — so a rewrite there is paid for twice and then discarded.
 * HIDDEN stays in: a hidden item is one the seller means to show again.
 *
 * Guard three is `descriptionWrittenAt: null`. It is what makes the button
 * resumable rather than repeatable: press it again and it continues through
 * the ones it has not reached, instead of buying the first twelve a second
 * time.
 *
 * Guard four is the attempt cap, and it closes the hole guard three opened. A
 * failed call deliberately stamps nothing, so the item comes back around — the
 * right behaviour for a network blip. But selection is deterministic, so an
 * item the model will never describe is picked FIRST on every press, paid for
 * every time, while `remaining` never reaches zero and the screen goes on
 * saying "press again to continue". The seller obeys. Two attempts and an item
 * stops being offered: a blip gets its retry, a hopeless photograph stops
 * costing money.
 */
const MAX_ATTEMPTS = 2

const REWRITABLE: Prisma.ItemWhereInput = {
  status: { notIn: [ItemStatus.SOLD, ItemStatus.DRAFT] },
  photos: { some: {} },
  descriptionWrittenAt: null,
  descriptionAttempts: { lt: MAX_ATTEMPTS },
}

/**
 * How many items a rewrite would still touch — so the screen can say what a
 * press costs before the seller spends it.
 *
 * One number, not two. It also reported how many it would pass over, which
 * nothing rendered and which cost a second `count()` on every /admin/items
 * request: the screen says what is excluded in words ("sold items, drafts,
 * items with no photographs"), which is the part a seller can act on.
 */
export async function rewriteCount(): Promise<number> {
  return db.item.count({ where: REWRITABLE })
}

export type RewriteResult =
  | { ok: true; rewritten: number; failed: number; remaining: number; reason: AiFailure | null }
  | { ok: false; error: string }

/**
 * Rewrites up to `BATCH_LIMIT` descriptions, a few at a time, and reports how
 * many are left so the seller knows whether to press again.
 *
 * Batched inside the limit rather than all at once because twelve open sockets
 * answer the seller in one long silence; batched rather than one at a time
 * because twelve calls in series is most of a minute.
 *
 * Stops early when the account runs dry. The remaining calls would each fail
 * the same way, and spending the seller's wait on them tells them nothing the
 * first failure did not.
 */
export async function rewriteDescriptions(): Promise<RewriteResult> {
  if (!aiEnabled()) {
    return { ok: false, error: 'שיפור תיאורים דורש מפתח API. הוסיפו ANTHROPIC_API_KEY והפעילו מחדש.' }
  }
  if (inFlight) {
    return { ok: false, error: 'שיפור התיאורים כבר רץ. המתינו שיסתיים לפני שתנסו שוב.' }
  }

  inFlight = true
  try {
    return await run()
  } finally {
    inFlight = false
  }
}

async function run(): Promise<RewriteResult> {
  const [items, categories] = await Promise.all([
    db.item.findMany({
      where: REWRITABLE,
      orderBy: { createdAt: 'desc' },
      take: BATCH_LIMIT,
      select: { id: true, photos: { orderBy: { position: 'asc' }, select: { id: true } } },
    }),
    db.category.findMany({ orderBy: { name: 'asc' }, select: { name: true } }),
  ])
  if (items.length === 0) return { ok: true, rewritten: 0, failed: 0, remaining: 0, reason: null }

  const names = categories.map((category) => category.name)
  let rewritten = 0
  let failed = 0
  let reason: AiFailure | null = null

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const outcomes = await Promise.all(
      items.slice(i, i + CONCURRENCY).map((item) => rewriteOne(item.id, item.photos.map((p) => p.id), names)),
    )
    for (const outcome of outcomes) {
      if (outcome === null) rewritten++
      else {
        failed++
        // The first failure names the batch. OUT_OF_CREDIT outranks it: it is
        // the one the seller has to act on, and it is why the rest stopped.
        if (reason === null || outcome === 'OUT_OF_CREDIT') reason = outcome
      }
    }
    if (reason === 'OUT_OF_CREDIT') break
  }

  // Counted after the writes, so it is what is actually left rather than what
  // was left when this call started.
  return { ok: true, rewritten, failed, remaining: await db.item.count({ where: REWRITABLE }), reason }
}

/** The failure, or null when the item got its new description. */
async function rewriteOne(itemId: string, photoIds: string[], categories: string[]): Promise<AiFailure | null> {
  const bytes = await readPhotoBytes(photoIds)
  const images = photoIds.map((id) => bytes.get(id)).filter((webp): webp is Buffer => webp !== undefined)
  // Every file gone from disk. Nothing to show the model, and calling it with
  // no images would spend a request to be told so. Counted as an attempt all
  // the same — it costs nothing, but an item in this state can never succeed,
  // and leaving it in the queue is what keeps the screen asking for one more
  // press that will never be the last.
  if (images.length === 0) return await failed(itemId)

  const caption = await captionItem(images, categories).catch((err): AiResult<Caption> => {
    console.error('[rewrite] the caption call for item', itemId, 'threw:', err)
    return { ok: false, reason: 'FAILED' }
  })

  if (!caption.ok) {
    // Running out of credit is the one failure that says nothing about this
    // item. The seller tops up and presses again; burning an attempt for it
    // would quietly retire items the model never even saw.
    if (caption.reason === 'OUT_OF_CREDIT') return 'OUT_OF_CREDIT'
    return await failed(itemId)
  }

  const description = caption.value.description.trim()
  // An empty answer is not an improvement. The item keeps the description it
  // has rather than losing the one a buyer was reading — but the call was
  // paid for, so it counts.
  if (description === '') return await failed(itemId)

  await db.item.update({
    where: { id: itemId },
    data: { description, descriptionWrittenAt: new Date(), descriptionAttempts: 0 },
  })
  return null
}

/**
 * Records one spent attempt and reports the failure.
 *
 * Its own function because the increment is the easy half to forget, and
 * forgetting it on any one path puts that path back in the loop this cap
 * exists to break.
 */
async function failed(itemId: string): Promise<AiFailure> {
  await db.item
    .update({ where: { id: itemId }, data: { descriptionAttempts: { increment: 1 } } })
    .catch((err) => {
      // The item was deleted from another tab mid-run. Nothing to record, and
      // nothing that should take the rest of the batch down with it.
      console.error('[rewrite] could not record a failed attempt for item', itemId, ':', err)
    })
  return 'FAILED'
}
