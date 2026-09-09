import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ItemStatus, OrderStatus } from '@prisma/client'

// Every action here ends in revalidatePath, which needs the request context
// Next only provides while serving. The database writes are what this file is
// about, so stub the cache invalidation out.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { db } from '@/lib/db'
import { photoDir, photoFilename } from '@/lib/images'
import { utcDate } from '@/lib/dates'
import { DRAFT_NAME } from '@/lib/admin/draft'
import { resetDb } from '../helpers/db'
import { makeCategory, makeOrder } from '../helpers/factories'
import {
  movePhoto,
  removePhoto,
  bulkEdit,
  publishItems,
  discardItems,
  discardBatch,
} from '@/app/admin/items/import/actions'

const BATCH = 'batch-under-test'

let uploads: string
let previousUploadDir: string | undefined

beforeEach(async () => {
  await resetDb()
  previousUploadDir = process.env.UPLOAD_DIR
  uploads = await mkdtemp(path.join(tmpdir(), 'ys-import-actions-'))
  process.env.UPLOAD_DIR = uploads
})

afterEach(async () => {
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR
  else process.env.UPLOAD_DIR = previousUploadDir
  await rm(uploads, { recursive: true, force: true })
})

let n = 0

type DraftOverrides = {
  categoryId?: string
  name?: string
  priceAgorot?: number
  batchId?: string | null
  status?: ItemStatus
  from?: Date
  to?: Date
}

/** A DRAFT item of the batch under test — what `clusterBatch` leaves behind. */
async function makeDraft(overrides: DraftOverrides = {}) {
  const categoryId = overrides.categoryId ?? (await makeCategory(`cat-${n++}`)).id
  const s = `${n++}`
  return db.item.create({
    data: {
      slug: `draft-${s}`,
      name: overrides.name ?? DRAFT_NAME,
      description: '',
      priceAgorot: overrides.priceAgorot ?? 0,
      categoryId,
      pickupFrom: overrides.from ?? utcDate(2026, 9, 12),
      pickupTo: overrides.to ?? utcDate(2026, 9, 18),
      status: overrides.status ?? ItemStatus.DRAFT,
      importBatchId: overrides.batchId === undefined ? BATCH : overrides.batchId,
    },
  })
}

/** A photo row with a file on disk, so a test can see whether the files went too. */
async function makePhoto(data: { itemId?: string | null; batchId?: string | null; position?: number } = {}) {
  const photo = await db.photo.create({
    data: {
      itemId: data.itemId ?? null,
      importBatchId: data.batchId === undefined ? BATCH : data.batchId,
      width: 800,
      height: 600,
      lqip: 'x',
      position: data.position ?? 0,
    },
  })
  await mkdir(photoDir(photo.id), { recursive: true })
  await writeFile(path.join(photoDir(photo.id), photoFilename(400)), 'not really a webp')
  return photo
}

const itemIdOf = async (photoId: string) =>
  (await db.photo.findUnique({ where: { id: photoId }, select: { itemId: true } }))?.itemId

describe('movePhoto', () => {
  it('moves a photo to another item without touching its files or its provenance', async () => {
    const a = await makeDraft()
    const b = await makeDraft()
    const photo = await makePhoto({ itemId: a.id })

    expect(await movePhoto(photo.id, b.id)).toEqual({ ok: true, itemId: b.id })

    const moved = await db.photo.findUnique({ where: { id: photo.id } })
    expect(moved?.itemId).toBe(b.id)
    // importBatchId is provenance and is never cleared (spec §7.3).
    expect(moved?.importBatchId).toBe(BATCH)
    // A move is a database UPDATE; files are keyed by photo and must not move.
    expect(existsSync(path.join(photoDir(photo.id), photoFilename(400)))).toBe(true)
  })

  it('appends the moved photo after the ones already on the destination', async () => {
    const a = await makeDraft()
    const b = await makeDraft()
    await makePhoto({ itemId: b.id, position: 0 })
    await makePhoto({ itemId: b.id, position: 1 })
    const photo = await makePhoto({ itemId: a.id })

    await movePhoto(photo.id, b.id)

    const moved = await db.photo.findUnique({ where: { id: photo.id } })
    expect(moved?.position).toBe(2)
  })

  it('leaves an item photoless rather than deleting it when its last photo moves away', async () => {
    // The seller may be about to move another photo onto it. An item that
    // vanished under them would take its headline and price with it.
    const a = await makeDraft()
    const b = await makeDraft()
    const photo = await makePhoto({ itemId: a.id })

    await movePhoto(photo.id, b.id)

    expect(await db.item.findUnique({ where: { id: a.id } })).not.toBeNull()
    expect(await db.photo.count({ where: { itemId: a.id } })).toBe(0)
  })

  it('creates a fresh draft in the same batch, with the carried-forward category and window', async () => {
    const category = await makeCategory('ריהוט')
    const a = await makeDraft({
      categoryId: category.id,
      from: utcDate(2026, 10, 1),
      to: utcDate(2026, 10, 5),
    })
    const photo = await makePhoto({ itemId: a.id })

    const result = await movePhoto(photo.id, 'new')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const created = await db.item.findUnique({ where: { id: result.itemId } })
    expect(created).toMatchObject({
      status: ItemStatus.DRAFT,
      importBatchId: BATCH,
      priceAgorot: 0,
      name: DRAFT_NAME,
      categoryId: category.id,
    })
    expect(created?.pickupFrom).toEqual(utcDate(2026, 10, 1))
    expect(created?.pickupTo).toEqual(utcDate(2026, 10, 5))

    expect(await itemIdOf(photo.id)).toBe(result.itemId)
    // And the item it came off is still there, photoless.
    expect(await db.item.findUnique({ where: { id: a.id } })).not.toBeNull()
    expect(await db.photo.count({ where: { itemId: a.id } })).toBe(0)
  })

  it('refuses a photo that is not there', async () => {
    expect(await movePhoto('nope', 'new')).toEqual({ ok: false, error: 'התמונה לא נמצאה.' })
  })

  it('refuses an unknown destination and leaves the photo where it was', async () => {
    const a = await makeDraft()
    const photo = await makePhoto({ itemId: a.id })

    expect(await movePhoto(photo.id, 'no-such-item')).toEqual({ ok: false, error: 'הפריט לא נמצא.' })
    expect(await itemIdOf(photo.id)).toBe(a.id)
  })
})

describe('removePhoto', () => {
  it('deletes the row and every file of the photo', async () => {
    const a = await makeDraft()
    const photo = await makePhoto({ itemId: a.id })

    expect(await removePhoto(photo.id)).toEqual({ ok: true })
    expect(await db.photo.findUnique({ where: { id: photo.id } })).toBeNull()
    expect(existsSync(photoDir(photo.id))).toBe(false)
    // The item survives its last photo, as it does for a move.
    expect(await db.item.findUnique({ where: { id: a.id } })).not.toBeNull()
  })

  it('refuses a photo that is not there', async () => {
    expect(await removePhoto('nope')).toEqual({ ok: false, error: 'התמונה לא נמצאה.' })
  })
})

describe('bulkEdit', () => {
  it('applies the patch to exactly the given items and no others', async () => {
    const a = await makeDraft()
    const b = await makeDraft()
    const untouched = await makeDraft()

    expect(
      await bulkEdit([a.id, b.id], {
        price: '120',
        categoryName: 'כלי מטבח',
        pickupFrom: '2026-10-01',
        pickupTo: '2026-10-05',
      }),
    ).toEqual({ ok: true })

    const category = await db.category.findUnique({ where: { name: 'כלי מטבח' } })
    expect(category).not.toBeNull()

    for (const id of [a.id, b.id]) {
      const item = await db.item.findUnique({ where: { id } })
      expect(item?.priceAgorot).toBe(12000)
      expect(item?.categoryId).toBe(category?.id)
      expect(item?.pickupFrom).toEqual(utcDate(2026, 10, 1))
      expect(item?.pickupTo).toEqual(utcDate(2026, 10, 5))
    }

    const other = await db.item.findUnique({ where: { id: untouched.id } })
    expect(other?.priceAgorot).toBe(untouched.priceAgorot)
    expect(other?.categoryId).toBe(untouched.categoryId)
    expect(other?.pickupFrom).toEqual(untouched.pickupFrom)
  })

  it('applies only the fields the patch carries', async () => {
    const a = await makeDraft({ priceAgorot: 5000 })

    expect(await bulkEdit([a.id], { pickupFrom: '2026-10-01', pickupTo: '2026-10-05' })).toEqual({ ok: true })

    const item = await db.item.findUnique({ where: { id: a.id } })
    expect(item?.priceAgorot).toBe(5000)
    expect(item?.categoryId).toBe(a.categoryId)
    expect(item?.pickupTo).toEqual(utcDate(2026, 10, 5))
  })

  it('reuses an existing category rather than making a second one', async () => {
    const category = await makeCategory('ריהוט')
    const a = await makeDraft()

    await bulkEdit([a.id], { categoryName: '  ריהוט  ' })

    expect((await db.item.findUnique({ where: { id: a.id } }))?.categoryId).toBe(category.id)
    expect(await db.category.count({ where: { name: 'ריהוט' } })).toBe(1)
  })

  it('refuses an unparseable price with the message the item form uses, writing nothing', async () => {
    const a = await makeDraft({ priceAgorot: 5000 })

    expect(await bulkEdit([a.id], { price: 'בערך 800', pickupFrom: '2026-10-01', pickupTo: '2026-10-05' })).toEqual({
      ok: false,
      error: 'מחיר לא תקין.',
    })

    const item = await db.item.findUnique({ where: { id: a.id } })
    expect(item?.priceAgorot).toBe(5000)
    expect(item?.pickupFrom).toEqual(utcDate(2026, 9, 12))
  })

  it('refuses an empty category', async () => {
    const a = await makeDraft()
    expect(await bulkEdit([a.id], { categoryName: '   ' })).toEqual({ ok: false, error: 'צריך לבחור קטגוריה.' })
    expect(await db.category.count()).toBe(1)
  })

  it('refuses a window that ends before it starts', async () => {
    const a = await makeDraft()
    expect(await bulkEdit([a.id], { pickupFrom: '2026-10-05', pickupTo: '2026-10-01' })).toEqual({
      ok: false,
      error: 'חלון האיסוף מסתיים לפני שהוא מתחיל.',
    })
  })

  it('refuses half a window, which has no meaning across a selection', async () => {
    const a = await makeDraft()
    expect(await bulkEdit([a.id], { pickupFrom: '2026-10-01' })).toEqual({
      ok: false,
      error: 'חלון איסוף לא תקין.',
    })
    expect((await db.item.findUnique({ where: { id: a.id } }))?.pickupFrom).toEqual(utcDate(2026, 9, 12))
  })

  it('is a no-op for an empty patch or an empty selection', async () => {
    const a = await makeDraft({ priceAgorot: 5000 })
    expect(await bulkEdit([a.id], {})).toEqual({ ok: true })
    expect(await bulkEdit([], { price: '120' })).toEqual({ ok: true })
    expect((await db.item.findUnique({ where: { id: a.id } }))?.priceAgorot).toBe(5000)
  })
})

/**
 * The refusals a seller reads off the card. Stated here as literals rather than
 * imported from the implementation, so a reworded message has to be rewritten
 * in both places by someone who looked at it.
 */
const UNPRICED = 'צריך לקבוע מחיר לפני הפרסום. פריט שניתן בחינם אפשר לפרסם מדף הפריט.'
const HELD = 'הפריט שמור להזמנה פעילה. בטלו את ההזמנה כדי לשחרר אותו.'
const ORDERED = 'הפריט נמכר דרך האתר ושייך להזמנה. בטלו את ההזמנה כדי לשחרר אותו.'
const MARKED_SOLD = 'הפריט מסומן כנמכר. אפשר להחזיר אותו למכירה מדף הפריט.'
const ALREADY_PUBLISHED = 'הפריט כבר פורסם ואינו חלק מהייבוא. אפשר לטפל בו מרשימת הפריטים.'

describe('publishItems', () => {
  it('publishes the items it can and reports the ones it cannot', async () => {
    // One incomplete item must not cost the seller the whole publish: they
    // selected twenty, and nineteen of them are ready.
    const ready = await makeDraft({ name: 'ספה תלת מושבית', priceAgorot: 12345 })
    const unpriced = await makeDraft({ name: 'כיסא', priceAgorot: 0 })
    const unnamed = await makeDraft({ name: '', priceAgorot: 9900 })

    const result = await publishItems([ready.id, unpriced.id, unnamed.id])

    expect(result.ok).toBe(true)
    expect(result.published).toBe(1)
    expect(result.refused).toEqual([
      { id: unpriced.id, error: UNPRICED },
      { id: unnamed.id, error: 'צריך שם לפריט.' },
    ])

    expect((await db.item.findUnique({ where: { id: ready.id } }))?.status).toBe(ItemStatus.AVAILABLE)
    expect((await db.item.findUnique({ where: { id: unpriced.id } }))?.status).toBe(ItemStatus.DRAFT)
    expect((await db.item.findUnique({ where: { id: unnamed.id } }))?.status).toBe(ItemStatus.DRAFT)
  })

  it('keeps the price it published, to the agora', async () => {
    const ready = await makeDraft({ name: 'מנורה', priceAgorot: 12345 })
    await publishItems([ready.id])
    expect((await db.item.findUnique({ where: { id: ready.id } }))?.priceAgorot).toBe(12345)
  })

  it('gives the published draft a slug from its real name, as updateItem does', async () => {
    // Evidence that publishing routes through updateItem rather than flipping
    // the status by hand: only that path regenerates a draft's placeholder slug.
    const ready = await makeDraft({ name: 'שולחן עץ', priceAgorot: 20000 })
    expect(ready.slug.startsWith('draft-')).toBe(true)

    await publishItems([ready.id])

    const published = await db.item.findUnique({ where: { id: ready.id } })
    expect(published?.slug.startsWith('draft-')).toBe(false)
    expect(published?.slug).toContain('שולחן')
  })

  it('refuses an item that is not there without touching the rest', async () => {
    const ready = await makeDraft({ name: 'מנורה', priceAgorot: 20000 })

    const result = await publishItems(['no-such-item', ready.id])

    expect(result.published).toBe(1)
    expect(result.refused).toEqual([{ id: 'no-such-item', error: 'הפריט לא נמצא.' }])
  })

  it('will not put an item sold through the shop back on it', async () => {
    // The double-sell this project fought through in its original build,
    // arriving by a new door: an imported item keeps its importBatchId after
    // publishing, so the review screen goes on listing it, and a second
    // "publish selection" over a since-sold item would flip it back to
    // AVAILABLE while its OrderItem still points at it. `setItemStatus`
    // refuses exactly this transition; publishing must too.
    const sold = await makeDraft({ name: 'ספה', priceAgorot: 10000, status: ItemStatus.SOLD })
    const ready = await makeDraft({ name: 'מנורה', priceAgorot: 20000 })
    await makeOrder([sold.id], { status: OrderStatus.PAID })

    const result = await publishItems([sold.id, ready.id])

    expect(result.published).toBe(1)
    expect(result.refused).toEqual([{ id: sold.id, error: ORDERED }])
    expect((await db.item.findUnique({ where: { id: sold.id } }))?.status).toBe(ItemStatus.SOLD)
    expect((await db.item.findUnique({ where: { id: ready.id } }))?.status).toBe(ItemStatus.AVAILABLE)
  })

  it('will not publish an item a live hold is counting on', async () => {
    const held = await makeDraft({ name: 'אופניים', priceAgorot: 30000, status: ItemStatus.RESERVED })
    await makeOrder([held.id], { status: OrderStatus.PENDING_PAYMENT })

    const result = await publishItems([held.id])

    expect(result.published).toBe(0)
    expect(result.refused).toEqual([{ id: held.id, error: HELD }])
    expect((await db.item.findUnique({ where: { id: held.id } }))?.status).toBe(ItemStatus.RESERVED)
  })

  it('will not publish an item the seller marked sold by hand', async () => {
    // No order at all — sold at the door. The seller said it is gone, and a
    // bulk publish must not quietly contradict them.
    const sold = await makeDraft({ name: 'מיקסר', priceAgorot: 15000, status: ItemStatus.SOLD })

    const result = await publishItems([sold.id])

    expect(result.published).toBe(0)
    expect(result.refused).toEqual([{ id: sold.id, error: MARKED_SOLD }])
    expect((await db.item.findUnique({ where: { id: sold.id } }))?.status).toBe(ItemStatus.SOLD)
  })

  it('publishes an item whose only order was cancelled', async () => {
    // A cancelled order has released its claim — the same rule setItemStatus
    // applies, so an over-broad guard would strand the item off the shop.
    const item = await makeDraft({ name: 'כורסה', priceAgorot: 40000, status: ItemStatus.AVAILABLE })
    await makeOrder([item.id], { status: OrderStatus.CANCELLED })

    const result = await publishItems([item.id])

    expect(result.published).toBe(1)
    expect(result.refused).toEqual([])
  })

  it('tells an unpriced item what to do about it, instead of calling the price invalid', async () => {
    // bulkEdit accepts '0', so a seller can deliberately set a free item and
    // then be told their price is "invalid". Both halves of this have to be
    // true for the seller: publishing here needs a price, and a genuinely
    // free item still has somewhere to go.
    const free = await makeDraft({ name: 'ארגז ספרים', priceAgorot: 0 })

    expect(await bulkEdit([free.id], { price: '0' })).toEqual({ ok: true })

    const result = await publishItems([free.id])
    expect(result.refused).toEqual([{ id: free.id, error: UNPRICED }])
    expect((await db.item.findUnique({ where: { id: free.id } }))?.status).toBe(ItemStatus.DRAFT)
  })
})

describe('discardItems', () => {
  it('deletes the items, their photo rows and their files', async () => {
    const a = await makeDraft()
    const b = await makeDraft()
    const photoA = await makePhoto({ itemId: a.id })
    const photoB = await makePhoto({ itemId: b.id })

    expect(await discardItems([a.id, b.id])).toEqual({ ok: true, discarded: 2, refused: [] })

    expect(await db.item.count()).toBe(0)
    expect(await db.photo.count()).toBe(0)
    for (const id of [photoA.id, photoB.id]) expect(existsSync(photoDir(id))).toBe(false)
  })

  it('refuses a published item in the selection and deletes the rest', async () => {
    // The review page queries DRAFT only, but that is the UI keeping a
    // promise, and two tabs on one batch break it: tab A publishes, tab B is
    // still showing those cards, and select-all + מחיקה takes a live listing
    // off the shop with its photos. The same argument the batch discard makes
    // for not trusting the move menu.
    const live = await makeDraft({ name: 'ספה', priceAgorot: 10000, status: ItemStatus.AVAILABLE })
    const livePhoto = await makePhoto({ itemId: live.id })
    const leftover = await makeDraft()
    const leftoverPhoto = await makePhoto({ itemId: leftover.id })

    const result = await discardItems([live.id, leftover.id])

    expect(result.discarded).toBe(1)
    expect(result.refused).toEqual([{ id: live.id, error: ALREADY_PUBLISHED }])

    expect(await db.item.findUnique({ where: { id: live.id } })).not.toBeNull()
    expect(existsSync(photoDir(livePhoto.id))).toBe(true)
    expect(await db.item.findUnique({ where: { id: leftover.id } })).toBeNull()
    expect(existsSync(photoDir(leftoverPhoto.id))).toBe(false)
  })

  it('leaves an item that belongs to an order alone, and says so', async () => {
    const sold = await makeDraft({ name: 'ספה', priceAgorot: 10000, status: ItemStatus.AVAILABLE })
    await makeOrder([sold.id], { status: OrderStatus.PAID })

    const result = await discardItems([sold.id])

    expect(result.discarded).toBe(0)
    expect(result.refused).toEqual([{ id: sold.id, error: ALREADY_PUBLISHED }])
    expect(await db.item.findUnique({ where: { id: sold.id } })).not.toBeNull()
  })

  it('reports an item that is not there rather than counting it deleted', async () => {
    expect(await discardItems(['no-such-item'])).toEqual({
      ok: true,
      discarded: 0,
      refused: [{ id: 'no-such-item', error: 'הפריט לא נמצא.' }],
    })
  })
})

describe('discardBatch', () => {
  it('deletes a photo that was never attached to any item', async () => {
    // The reason discardBatch exists. Between /api/import writing photos and
    // clusterBatch attaching them a photo belongs to no item, so nothing
    // item-keyed can reach it: a closed tab in that window leaves the row and
    // its files behind forever, and no screen can show them.
    const loose = await makePhoto({ itemId: null })
    const alsoLoose = await makePhoto({ itemId: null, position: 1 })

    expect(await discardBatch(BATCH)).toEqual({ ok: true, items: 0, photos: 2 })

    expect(await db.photo.count()).toBe(0)
    for (const photo of [loose, alsoLoose]) expect(existsSync(photoDir(photo.id))).toBe(false)
  })

  it('deletes the batch items, their attached photos, the loose ones and every file', async () => {
    const a = await makeDraft()
    const b = await makeDraft()
    const attached = await makePhoto({ itemId: a.id })
    const alsoAttached = await makePhoto({ itemId: b.id })
    const loose = await makePhoto({ itemId: null })

    expect(await discardBatch(BATCH)).toEqual({ ok: true, items: 2, photos: 3 })

    expect(await db.item.count({ where: { importBatchId: BATCH } })).toBe(0)
    expect(await db.photo.count()).toBe(0)
    for (const photo of [attached, alsoAttached, loose]) expect(existsSync(photoDir(photo.id))).toBe(false)
  })

  it('removes the files of a photo added to a batch item after the import', async () => {
    // Its importBatchId is null — it did not arrive in the drop — but the
    // item's deletion cascades its row, so its files have to go with it.
    const a = await makeDraft()
    const later = await makePhoto({ itemId: a.id, batchId: null })

    expect(await discardBatch(BATCH)).toEqual({ ok: true, items: 1, photos: 1 })
    expect(await db.photo.count()).toBe(0)
    expect(existsSync(photoDir(later.id))).toBe(false)
  })

  it('leaves another batch entirely alone', async () => {
    const mine = await makeDraft()
    await makePhoto({ itemId: mine.id })
    const other = await makeDraft({ batchId: 'another-batch' })
    const otherPhoto = await makePhoto({ itemId: other.id, batchId: 'another-batch' })
    const otherLoose = await makePhoto({ itemId: null, batchId: 'another-batch' })

    expect(await discardBatch(BATCH)).toEqual({ ok: true, items: 1, photos: 1 })

    expect(await db.item.findUnique({ where: { id: other.id } })).not.toBeNull()
    expect(await db.photo.count({ where: { importBatchId: 'another-batch' } })).toBe(2)
    for (const photo of [otherPhoto, otherLoose]) expect(existsSync(photoDir(photo.id))).toBe(true)
  })

  it('keeps an item an order is counting on, and that item keeps its photos', async () => {
    const sold = await makeDraft({ name: 'ספה', priceAgorot: 10000, status: ItemStatus.AVAILABLE })
    const keptPhoto = await makePhoto({ itemId: sold.id })
    const discarded = await makeDraft()
    const discardedPhoto = await makePhoto({ itemId: discarded.id })
    await makeOrder([sold.id], { status: OrderStatus.PAID })

    expect(await discardBatch(BATCH)).toEqual({ ok: true, items: 1, photos: 1 })

    expect(await db.item.findUnique({ where: { id: sold.id } })).not.toBeNull()
    expect(await db.photo.findUnique({ where: { id: keptPhoto.id } })).not.toBeNull()
    expect(existsSync(photoDir(keptPhoto.id))).toBe(true)

    expect(await db.item.findUnique({ where: { id: discarded.id } })).toBeNull()
    expect(existsSync(photoDir(discardedPhoto.id))).toBe(false)
  })

  it('leaves the items the seller already published, and their files', async () => {
    // "מחיקת כל הייבוא" is offered for as long as one draft remains, right
    // under a header counting how many items are already live. Sweeping those
    // too would take twenty real listings off the shop, with their photos,
    // while the screen was saying they were safe. Only a draft is leftover
    // import; anything published has left the review and is a listing now.
    const live = await makeDraft({ name: 'ספה', priceAgorot: 10000, status: ItemStatus.AVAILABLE })
    const livePhoto = await makePhoto({ itemId: live.id })
    const hidden = await makeDraft({ name: 'כיסא', priceAgorot: 8000, status: ItemStatus.HIDDEN })
    const hiddenPhoto = await makePhoto({ itemId: hidden.id })
    const leftover = await makeDraft()
    const leftoverPhoto = await makePhoto({ itemId: leftover.id })

    expect(await discardBatch(BATCH)).toEqual({ ok: true, items: 1, photos: 1 })

    for (const [item, photo] of [
      [live, livePhoto],
      [hidden, hiddenPhoto],
    ]) {
      expect(await db.item.findUnique({ where: { id: item.id } })).not.toBeNull()
      expect(await db.photo.findUnique({ where: { id: photo.id } })).not.toBeNull()
      expect(existsSync(photoDir(photo.id))).toBe(true)
    }

    expect(await db.item.findUnique({ where: { id: leftover.id } })).toBeNull()
    expect(existsSync(photoDir(leftoverPhoto.id))).toBe(false)
  })

  it('leaves a batch photo that now belongs to an item outside the batch', async () => {
    // The sweep may only take a photo whose item is going with it. A photo
    // carries its batch id for life, so one moved onto an item from another
    // drop still looks like this batch's — and deleting its row and files
    // would take a photo off an item that is still on the shop, with nothing
    // failing. Today's move menu only offers in-batch items; that is the UI
    // keeping a promise, not an invariant, so the filter must not rely on it.
    const outside = await makeDraft({ batchId: null, status: ItemStatus.AVAILABLE })
    const moved = await makePhoto({ itemId: outside.id })
    const mine = await makeDraft()
    const minePhoto = await makePhoto({ itemId: mine.id })

    expect(await discardBatch(BATCH)).toEqual({ ok: true, items: 1, photos: 1 })

    expect(await db.item.findUnique({ where: { id: outside.id } })).not.toBeNull()
    expect(await db.photo.findUnique({ where: { id: moved.id } })).not.toBeNull()
    expect(existsSync(photoDir(moved.id))).toBe(true)

    expect(await db.item.findUnique({ where: { id: mine.id } })).toBeNull()
    expect(existsSync(photoDir(minePhoto.id))).toBe(false)
  })

  it('reports nothing for a batch that does not exist', async () => {
    expect(await discardBatch('never-happened')).toEqual({ ok: true, items: 0, photos: 0 })
  })
})
