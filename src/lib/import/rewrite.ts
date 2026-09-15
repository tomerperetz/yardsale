import { ItemStatus } from '@prisma/client'
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
 */

/** How many model calls are in flight at once. */
const CONCURRENCY = 4

/**
 * What a rewrite is allowed to touch: anything with a photograph to look at
 * that a buyer might still read.
 *
 * SOLD is excluded because its listing is history — the money has moved, the
 * item is gone, and rewriting its description spends the seller's credit on
 * something nobody will read. Everything else qualifies, HIDDEN and DRAFT
 * included: a hidden item is one the seller means to show again.
 */
const REWRITABLE = {
  status: { not: ItemStatus.SOLD },
  photos: { some: {} },
} as const

export type RewriteCounts = { rewritable: number; skipped: number }

/**
 * How many items a rewrite would touch, and how many it would pass over — so
 * the screen can say what a click costs before the seller spends it. Every
 * one of those items is a paid model call.
 */
export async function rewriteCounts(): Promise<RewriteCounts> {
  const [total, rewritable] = await Promise.all([
    db.item.count(),
    db.item.count({ where: REWRITABLE }),
  ])
  return { rewritable, skipped: total - rewritable }
}

export type RewriteResult =
  | { ok: true; rewritten: number; failed: number; reason: AiFailure | null }
  | { ok: false; error: string }

/**
 * Rewrites every eligible item's description, a few at a time.
 *
 * Batched rather than all at once because a shop with sixty items would open
 * sixty sockets and answer the seller in one long silence; batched rather than
 * one at a time because sixty calls in series is minutes of a page waiting.
 *
 * Stops early when the account runs dry. The remaining calls would each fail
 * the same way, and spending the seller's wait on them tells them nothing the
 * first failure did not.
 */
export async function rewriteDescriptions(): Promise<RewriteResult> {
  if (!aiEnabled()) {
    return { ok: false, error: 'שיפור תיאורים דורש מפתח API. הוסיפו ANTHROPIC_API_KEY והפעילו מחדש.' }
  }

  const [items, categories] = await Promise.all([
    db.item.findMany({
      where: REWRITABLE,
      orderBy: { createdAt: 'desc' },
      select: { id: true, photos: { orderBy: { position: 'asc' }, select: { id: true } } },
    }),
    db.category.findMany({ orderBy: { name: 'asc' }, select: { name: true } }),
  ])
  if (items.length === 0) return { ok: true, rewritten: 0, failed: 0, reason: null }

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

  return { ok: true, rewritten, failed, reason }
}

/** The failure, or null when the item got its new description. */
async function rewriteOne(itemId: string, photoIds: string[], categories: string[]): Promise<AiFailure | null> {
  const bytes = await readPhotoBytes(photoIds)
  const images = photoIds.map((id) => bytes.get(id)).filter((webp): webp is Buffer => webp !== undefined)
  // Every file gone from disk. Nothing to show the model, and calling it with
  // no images would spend a request to be told so.
  if (images.length === 0) return 'FAILED'

  const caption = await captionItem(images, categories).catch((err): AiResult<Caption> => {
    console.error('[rewrite] the caption call for item', itemId, 'threw:', err)
    return { ok: false, reason: 'FAILED' }
  })
  if (!caption.ok) return caption.reason

  const description = caption.value.description.trim()
  // An empty answer is not an improvement. The item keeps the description it
  // has rather than losing the one a buyer was reading.
  if (description === '') return 'FAILED'

  await db.item.update({ where: { id: itemId }, data: { description } })
  return null
}
