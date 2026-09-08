'use server'

import { revalidatePath } from 'next/cache'
import { ItemStatus, type Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { deletePhotoFiles } from '@/lib/images'
import { parseShekelInput } from '@/lib/money'
import { hebrewSlug, randomSuffix } from '@/lib/slug'
import { DRAFT_NAME } from '@/lib/admin/draft'
import {
  categoryId,
  deleteItem,
  normalizeCategoryName,
  parseDate,
  updateItem,
  HELD_BY_ORDER,
  LIVE_ORDER_STATUSES,
  SOLD_THROUGH_SHOP,
} from '@/lib/admin/items'
import { carriedForward, clusterBatch, type ClusterBatchResult } from '@/lib/import/batch'

/**
 * The import flow's server actions. As with src/app/admin/items/actions.ts,
 * these are thin wrappers: the logic lives in plain modules that a test can
 * call directly, and this file exists only because a client component can
 * invoke nothing that does not carry the 'use server' directive.
 *
 * Authentication is src/middleware.ts's, whose matcher covers /admin/:path* —
 * a server action posts to the route it was rendered from, and every screen
 * that can reach these is under /admin.
 *
 * Nothing here may be exported except an async function: that is the rule a
 * 'use server' file is compiled under, which is why the result types below are
 * local. Their callers read them off the functions.
 */

type MoveResult = { ok: true; itemId: string } | { ok: false; error: string }
type EditResult = { ok: true } | { ok: false; error: string }
type PublishResult = { ok: true; published: number; refused: { id: string; error: string }[] }
type DiscardBatchResult = { ok: true; items: number; photos: number }

/** What the bulk bar can set across a selection — every field optional, each applied only if present. */
type BulkPatch = { price?: string; categoryName?: string; pickupFrom?: string; pickupTo?: string }

const PHOTO_MISSING = 'התמונה לא נמצאה.'
const ITEM_MISSING = 'הפריט לא נמצא.'

/**
 * An item the seller marked sold at the door, with no order behind it.
 * `setItemStatus` lets them undo that from the item's own page, which is why
 * this says where to go rather than just refusing.
 */
const MARKED_SOLD = 'הפריט מסומן כנמכר. אפשר להחזיר אותו למכירה מדף הפריט.'

/**
 * What an item priced at 0 is told, and it has to be true in both directions.
 *
 * `clusterBatch` creates every imported draft at 0 as "the seller has not
 * priced this yet" (spec §1.3 leaves every price to them), so publishing 0
 * through would put a whole import on the shop for free — the refusal stays.
 * But `bulkEdit` accepts '0', so a seller who deliberately made something free
 * lands here too, and telling them their price is invalid would be a lie about
 * input they chose. So: say what publishing needs, and where a genuinely free
 * item can still be published, which is the single-item form — `updateItem`
 * has no such rule and takes 0 as a price like any other.
 */
const UNPRICED = 'צריך לקבוע מחיר לפני הפרסום. פריט שניתן בחינם אפשר לפרסם מדף הפריט.'

/**
 * Groups a finished upload batch into DRAFT items and writes their copy.
 * See `clusterBatch` (spec §7.2): it degrades rather than failing, so the
 * seller reaches the review screen with every photo on an item even when the
 * model call does not happen at all.
 */
export async function clusterBatchAction(batchId: string): Promise<ClusterBatchResult> {
  const result = await clusterBatch(batchId)
  // The drafts show up in the seller's item list straight away, review screen
  // or not — spec §3.4 is that closing the tab loses nothing.
  if (result.ok) revalidatePath('/admin/items')
  return result
}

/**
 * Puts one photo on a different product, or on a brand new one — the seller's
 * correction when clustering put a photo with the wrong thing (spec §7.3).
 *
 * No file moves. Storage is keyed by the photo (src/lib/images.ts), so this is
 * a single UPDATE with nothing on disk that can half-fail, and `importBatchId`
 * is untouched: it records which drop the photo arrived in and is never
 * cleared, so the batch-wide discard can still reach this photo afterwards.
 *
 * The item a photo leaves is deliberately left standing, even with no photos
 * on it at all. The seller is usually mid-correction and about to move another
 * photo onto it; an item that deleted itself would take the headline, price
 * and pickup window they had already set with it.
 */
export async function movePhoto(photoId: string, toItemId: string | 'new'): Promise<MoveResult> {
  const photo = await db.photo.findUnique({
    where: { id: photoId },
    select: { id: true, itemId: true, importBatchId: true },
  })
  if (!photo) return { ok: false, error: PHOTO_MISSING }
  if (toItemId !== 'new' && photo.itemId === toItemId) return { ok: true, itemId: toItemId }

  // Read outside the transaction below: `carriedForward` uses the shared
  // client, and on a shop with no items and no categories at all it writes a
  // fallback category — neither of which can join a transaction it was not
  // handed. It is only consulted for a new item.
  const defaults = toItemId === 'new' ? await carriedForward() : null

  const itemId = await db.$transaction(async (tx) => {
    let destination = toItemId
    if (defaults) {
      const created = await tx.item.create({
        data: {
          // The same placeholder name, slug and price a clustered draft is
          // created with (spec §7.2 step 4): nothing has been generated for
          // this item, and a draft regenerates its slug on the first real save.
          slug: hebrewSlug(DRAFT_NAME, randomSuffix()),
          name: DRAFT_NAME,
          description: '',
          priceAgorot: 0,
          categoryId: defaults.categoryId,
          pickupFrom: defaults.pickupFrom,
          pickupTo: defaults.pickupTo,
          status: ItemStatus.DRAFT,
          importBatchId: photo.importBatchId,
        },
      })
      destination = created.id
    } else {
      const target = await tx.item.findUnique({ where: { id: toItemId }, select: { id: true } })
      if (!target) return null
    }

    // Appended, not inserted: the destination's first photo is its cover, and
    // a photo the seller drags over from elsewhere must not silently become it.
    const last = await tx.photo.aggregate({ where: { itemId: destination }, _max: { position: true } })
    await tx.photo.update({
      where: { id: photoId },
      data: { itemId: destination, position: (last._max.position ?? -1) + 1 },
    })

    return destination
  })

  if (!itemId) return { ok: false, error: ITEM_MISSING }

  revalidatePath('/admin/items')
  return { ok: true, itemId }
}

/**
 * Drops one photo from the import for good — its row and every width of it on
 * disk (spec §7.3).
 *
 * Row first, files second, and only once the row is committed gone: the same
 * order `deleteItem` uses, so a crash between the two can leave a file with no
 * row (invisible, and swept by the batch discard) but never a row pointing at
 * a file that is not there.
 */
export async function removePhoto(photoId: string): Promise<EditResult> {
  const removed = await db.photo.deleteMany({ where: { id: photoId } })
  if (removed.count === 0) return { ok: false, error: PHOTO_MISSING }

  // Never throws — a cleanup failure must not turn a completed delete into an
  // error the seller sees and retries against a row that is already gone.
  await deletePhotoFiles(photoId)

  revalidatePath('/admin/items')
  return { ok: true }
}

/**
 * Sets price, category and pickup window across a selection at once — the
 * point of the review screen, and the one thing spec §1.3 asks be a single
 * action rather than twenty.
 *
 * Every field is optional and only the ones present are written, so setting a
 * window across six items cannot quietly reprice them. Validation is the item
 * form's, message for message, because the seller sees the same words here.
 *
 * The whole call is validated before anything is written: it either applies to
 * every selected item or to none. That is also why a pickup window must arrive
 * whole — one end alone would have to be checked against each item's stored
 * other end, and this signature has no way to say "four applied, two did not".
 */
export async function bulkEdit(itemIds: string[], patch: BulkPatch): Promise<EditResult> {
  if (itemIds.length === 0) return { ok: true }

  const data: Prisma.ItemUncheckedUpdateManyInput = {}

  if (patch.price !== undefined) {
    const priceAgorot = parseShekelInput(patch.price)
    if (priceAgorot === null) return { ok: false, error: 'מחיר לא תקין.' }
    data.priceAgorot = priceAgorot
  }

  if (patch.pickupFrom !== undefined || patch.pickupTo !== undefined) {
    const from = parseDate(patch.pickupFrom ?? '')
    const to = parseDate(patch.pickupTo ?? '')
    if (!from || !to) return { ok: false, error: 'חלון איסוף לא תקין.' }
    if (to.getTime() < from.getTime()) return { ok: false, error: 'חלון האיסוף מסתיים לפני שהוא מתחיל.' }
    data.pickupFrom = from
    data.pickupTo = to
  }

  const category = patch.categoryName === undefined ? null : normalizeCategoryName(patch.categoryName)
  if (category === '') return { ok: false, error: 'צריך לבחור קטגוריה.' }

  if (category === null && Object.keys(data).length === 0) return { ok: true }

  await db.$transaction(async (tx) => {
    // Inside the transaction because it may create the category: a selection
    // that then fails to update must not leave a category nothing points at.
    if (category !== null) data.categoryId = await categoryId(tx, category)
    await tx.item.updateMany({ where: { id: { in: itemIds } }, data })
  })

  revalidatePath('/admin/items')
  return { ok: true }
}

/**
 * Publishes as much of the selection as is ready, and says what it could not.
 *
 * One item missing a price must not cost the seller the other nineteen — they
 * selected all twenty precisely to avoid twenty round trips, and an all-or-
 * nothing publish would hand them back the same work. So each item is its own
 * outcome and the refusals come back as a list the screen can point at.
 *
 * Routed through `updateItem` rather than a status flip, which is what keeps
 * the validation and its Hebrew messages identical to the single-item form's
 * (spec §7.3) and what gives a draft the proper slug for the name it is being
 * published under.
 *
 * What `updateItem` does NOT do is ask whether publishing is allowed at all:
 * `publish: true` sets AVAILABLE unconditionally, and an item's own status is
 * the one thing this screen can still be looking at while the shop has moved
 * on. An imported item keeps its `importBatchId` after it is published, so the
 * review screen goes on listing it, and a second pass over the selection would
 * otherwise put an item that has since sold back on the shop to be bought
 * again while its OrderItem still points at it. `setItemStatus` refuses that
 * transition and so does this, in the same order and with the same words.
 *
 * Sequential on purpose: `updateItem` creates the category it is given if it
 * is new, and a selection sharing one new category would race itself into a
 * unique-constraint failure if these ran together.
 */
export async function publishItems(itemIds: string[]): Promise<PublishResult> {
  let published = 0
  const refused: { id: string; error: string }[] = []

  for (const id of itemIds) {
    const item = await db.item.findUnique({
      where: { id },
      select: {
        name: true,
        description: true,
        priceAgorot: true,
        pickupFrom: true,
        pickupTo: true,
        status: true,
        category: { select: { name: true } },
        // Cancelled and expired orders have released their claim, so an item
        // that appears only on those is the seller's to publish again.
        orderItems: { where: { order: { status: { in: LIVE_ORDER_STATUSES } } }, select: { id: true }, take: 1 },
      },
    })
    if (!item) {
      refused.push({ id, error: ITEM_MISSING })
      continue
    }

    // Before anything else: an item an order is counting on, or one the seller
    // has already called sold, must not move underneath either of them —
    // whatever else may also be wrong with it.
    const blocked = refusedByStatus(item)
    if (blocked) {
      refused.push({ id, error: blocked })
      continue
    }

    if (item.priceAgorot === 0) {
      refused.push({ id, error: UNPRICED })
      continue
    }

    const result = await updateItem(id, {
      name: item.name,
      description: item.description,
      // Never 0 by here — that is refused above with something a seller can
      // act on, rather than handed to `updateItem` as an empty string for the
      // sake of borrowing its 'מחיר לא תקין.'
      price: String(item.priceAgorot / 100),
      categoryName: item.category.name,
      pickupFrom: dateInput(item.pickupFrom),
      pickupTo: dateInput(item.pickupTo),
      // updateItem does not attach photos; the import screen has already put
      // every photo where the seller wants it.
      photoIds: [],
      publish: true,
    }).catch((err) => {
      // Still this item's problem alone — a row deleted from another tab
      // between the read above and the write must not abort the publish.
      console.error('[import] publishing item', id, 'failed:', err)
      return { ok: false as const, error: 'שגיאה בפרסום הפריט. נסו שוב.' }
    })

    if (result.ok) published += 1
    else refused.push({ id, error: result.error })
  }

  if (published > 0) {
    revalidatePath('/admin/items')
    revalidatePath('/')
  }
  return { ok: true, published, refused }
}

/**
 * Throws away the selected items with their photos and files.
 *
 * `deleteItem` does the work so the file cleanup keeps its one ordering rule —
 * the photo ids are read inside the transaction, before the rows naming them
 * go — and so the same refusals apply: an item a live or completed order is
 * counting on stays, because deleting it would orphan an OrderItem and corrupt
 * a buyer's history. That refusal is logged rather than returned; a discard
 * that skipped an item the seller had already sold is the safe outcome, and
 * this is called on drafts, where it cannot happen.
 */
export async function discardItems(itemIds: string[]): Promise<{ ok: true }> {
  for (const id of itemIds) {
    const result = await deleteItem(id)
    if (!result.ok) console.error('[import] discarding item', id, 'refused:', result.error)
  }

  if (itemIds.length > 0) revalidatePath('/admin/items')
  return { ok: true }
}

/**
 * Throws away a whole import — and the reason this exists alongside
 * `discardItems` (spec §7.3, "Discarding the batch, not just its items").
 *
 * Selection-based discard is keyed by item, and between /api/import writing
 * photos and `clusterBatch` attaching them a photo belongs to no item at all.
 * A hard failure or a closed tab in that window leaves rows and files that
 * nothing item-keyed can reach and no screen can show, and the leak grows by a
 * whole drop with every abandoned import. So the sweep is by `importBatchId`,
 * which reaches a photo whether or not it was ever attached.
 *
 * Two sets of photos go: the batch's own, and any added to one of the batch's
 * items afterwards — those carry no batch id but their rows cascade with the
 * item, so their files have to go with them.
 *
 * Items `deleteItem` would refuse are kept, along with their photos. A batch
 * item that has since been sold or ordered is not part of the leak this is
 * for, and deleting one would fail the whole sweep on a foreign key and leave
 * everything else behind.
 */
export async function discardBatch(batchId: string): Promise<DiscardBatchResult> {
  const removed = await db.$transaction(
    async (tx) => {
      const items = await tx.item.findMany({
        where: { importBatchId: batchId },
        select: { id: true, status: true, orderItems: { select: { id: true }, take: 1 } },
      })

      const keptCount = items.length - items.filter(deletable).length
      const doomed = new Set(items.filter(deletable).map((item) => item.id))

      // Read before anything deletes a row. Files are keyed by photo, so once
      // these rows are gone — and `Photo.itemId` cascades, so deleting the
      // items alone would take them — nothing ties a file to this batch, and a
      // lookup afterwards would find none and orphan every width forever.
      const candidates = await tx.photo.findMany({
        where: { OR: [{ importBatchId: batchId }, { itemId: { in: [...doomed] } }] },
        select: { id: true, itemId: true },
      })

      // An allowlist, not a denylist: a photo goes only if it has no item at
      // all, or its item is going with it. Asking instead which items are
      // being *kept* is subtly wrong, because it treats any item that is not
      // on that list as gone — including one outside this batch entirely. A
      // photo carries its batch id for life, so one moved onto an item from
      // another drop still looks like this batch's, and deleting its row and
      // files would strip a photo off an item still on the shop with nothing
      // failing. Today's move menu only offers in-batch items; that is the UI
      // keeping a promise, and this must not be the place that depends on it.
      //
      // Filtered here rather than in the query for the other half of the same
      // problem: expressing "and also every photo with no item at all" as a
      // where clause over a nullable column is exactly where an unattached
      // photo drops out of the sweep this function exists for.
      const photoIds = candidates
        .filter((photo) => photo.itemId === null || doomed.has(photo.itemId))
        .map((photo) => photo.id)

      await tx.photo.deleteMany({ where: { id: { in: photoIds } } })
      await tx.item.deleteMany({ where: { id: { in: [...doomed] } } })

      if (keptCount > 0) {
        console.error('[import] discarding batch', batchId, 'kept', keptCount, 'item(s) an order is counting on')
      }

      return { items: doomed.size, photoIds }
    },
    // A sixty-photo batch is sixty rows plus its items, and the default 5s is
    // a tight budget for that on a database that is not on this machine.
    { timeout: 30_000 },
  )

  // Only once the rows are committed gone, so a failed transaction never
  // leaves a Photo row pointing at files that are already deleted.
  await Promise.all(removed.photoIds.map((photoId) => deletePhotoFiles(photoId)))

  revalidatePath('/admin/items')
  return { ok: true, items: removed.items, photos: removed.photoIds.length }
}

/**
 * Whether the batch discard may take this item — `deleteItem`'s rule, restated
 * because the sweep deletes in bulk rather than one row at a time. An item that
 * has since been sold or ordered is not part of the leak the discard is for,
 * and taking one would fail the whole sweep on a foreign key.
 */
function deletable(item: { status: ItemStatus; orderItems: { id: string }[] }): boolean {
  return item.status !== ItemStatus.RESERVED && item.status !== ItemStatus.SOLD && item.orderItems.length === 0
}

/**
 * Why this item may not go on the shop, or null if nothing stops it.
 *
 * The order is `setItemStatus`'s, which is what makes the messages match case
 * for case: a RESERVED item is mid hold and hears about the hold, an item on a
 * live order was sold through the shop and hears about the order, and only an
 * item the seller marked sold with no order behind it gets the third message —
 * the one `setItemStatus` has no need for, because it is the transition that
 * undoes exactly this.
 */
function refusedByStatus(item: { status: ItemStatus; orderItems: { id: string }[] }): string | null {
  if (item.status === ItemStatus.RESERVED) return HELD_BY_ORDER
  if (item.orderItems.length > 0) return SOLD_THROUGH_SHOP
  if (item.status === ItemStatus.SOLD) return MARKED_SOLD
  return null
}

/** A stored pickup date as the `<input type="date">` string `parseDate` reads back. */
function dateInput(date: Date): string {
  return date.toISOString().slice(0, 10)
}
