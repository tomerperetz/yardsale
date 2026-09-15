import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ItemStatus } from '@prisma/client'
import type { AiResult, Caption } from '@/lib/ai/types'

/**
 * The AI client is mocked here, as it is in every test that reaches the import
 * path: no key is configured for the test run and the product owner pays for
 * every real call. Nothing in this file may reach the Anthropic API.
 */
const { clusterPhotos, captionItem, aiEnabled } = vi.hoisted(() => ({
  clusterPhotos: vi.fn<(photos: { id: string; webp: Buffer }[]) => Promise<AiResult<string[][]>>>(),
  captionItem: vi.fn<(images: Buffer[], categories: string[]) => Promise<AiResult<Caption>>>(),
  aiEnabled: vi.fn<() => boolean>(),
}))

vi.mock('@/lib/ai/client', () => ({ clusterPhotos, captionItem, aiEnabled }))

import { db } from '@/lib/db'
import { photoDir, photoFilename } from '@/lib/images'
import { clusterBatch, suggestForItem } from '@/lib/import/batch'
import { resetDb } from '../helpers/db'
import { makeItem, makeSettings } from '../helpers/factories'
import { startOfUtcDay, utcDate } from '@/lib/dates'
import { DEFAULT_SALE_DAYS } from '@/lib/sale-window'

const BATCH = 'batch-under-test'

let dir: string

beforeEach(async () => {
  await resetDb()
  dir = await mkdtemp(path.join(tmpdir(), 'ys-cluster-'))
  process.env.UPLOAD_DIR = dir

  clusterPhotos.mockReset()
  captionItem.mockReset()
  aiEnabled.mockReset()
  aiEnabled.mockReturnValue(true)
  captionItem.mockResolvedValue({ ok: true, value: { headline: 'כותרת', description: 'תיאור', category: '' , priceAgorot: 0 } })
})

afterEach(() => rm(dir, { recursive: true, force: true }))

/**
 * A batch photo with its 400px file on disk. The file's bytes are the photo's
 * own id, which is what lets a test say which photos a given model call was
 * shown without threading fixtures through.
 */
async function makePhotos(takenAts: (Date | null)[], batchId = BATCH): Promise<string[]> {
  const ids: string[] = []
  for (const [position, takenAt] of takenAts.entries()) {
    const photo = await db.photo.create({
      data: { importBatchId: batchId, width: 800, height: 600, lqip: 'x', position, takenAt },
    })
    await mkdir(photoDir(photo.id), { recursive: true })
    await writeFile(path.join(photoDir(photo.id), photoFilename(400)), photo.id)
    ids.push(photo.id)
  }
  return ids
}

/** Three photos with no capture time at all, which the fallback splits one per group. */
const threeUnstamped = () => makePhotos([null, null, null])

const ok = (groups: string[][]) => clusterPhotos.mockResolvedValue({ ok: true, value: groups })

const photosOf = (itemId: string) =>
  db.photo.findMany({ where: { itemId }, orderBy: { position: 'asc' }, select: { id: true, position: true } })

/** Every photo of the batch, on exactly one item — the invariant §7.2 turns on. */
async function assertEveryPhotoPlaced(ids: string[], itemIds: string[]) {
  const photos = await db.photo.findMany({ where: { importBatchId: BATCH }, select: { id: true, itemId: true } })
  expect(photos.map((p) => p.id).sort()).toEqual([...ids].sort())
  expect(photos.filter((p) => p.itemId === null)).toEqual([])
  for (const photo of photos) expect(itemIds).toContain(photo.itemId)
}

describe('clusterBatch — the successful path', () => {
  it("creates one DRAFT item per group, carrying the batch, price 0, the last item's category and the sale's window", async () => {
    await makeSettings({ saleFrom: utcDate(2026, 9, 15), saleTo: utcDate(2026, 9, 28) })
    const previous = await makeItem()
    const ids = await makePhotos([null, null, null])
    ok([[ids[0], ids[1]], [ids[2]]])

    const result = await clusterBatch(BATCH)

    expect(result).toMatchObject({ ok: true, notice: 'NONE' })
    if (!result.ok) return
    expect(result.itemIds).toHaveLength(2)

    const items = await db.item.findMany({ where: { id: { in: result.itemIds } } })
    for (const item of items) {
      expect(item.status).toBe(ItemStatus.DRAFT)
      expect(item.priceAgorot).toBe(0)
      expect(item.importBatchId).toBe(BATCH)
      expect(item.categoryId).toBe(previous.categoryId)
      // The window comes off Settings, not off `previous` — an imported item
      // must never inherit a window the seller has not looked at since.
      expect(item.pickupFrom).toEqual(utcDate(2026, 9, 15))
      expect(item.pickupTo).toEqual(utcDate(2026, 9, 28))
      expect(item.pickupFrom).not.toEqual(previous.pickupFrom)
    }
  })

  it('shows the model every photo of the batch, with its own bytes', async () => {
    const ids = await threeUnstamped()
    ok([ids])

    await clusterBatch(BATCH)

    const shown = clusterPhotos.mock.calls[0][0]
    expect(shown.map((p) => p.id)).toEqual(ids)
    expect(shown.map((p) => p.webp.toString())).toEqual(ids)
  })

  it('gives each group its photos, numbered from zero in group order', async () => {
    const ids = await makePhotos([null, null, null, null])
    ok([
      [ids[2], ids[0]],
      [ids[3], ids[1]],
    ])

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    expect(await photosOf(result.itemIds[0])).toEqual([
      { id: ids[2], position: 0 },
      { id: ids[0], position: 1 },
    ])
    expect(await photosOf(result.itemIds[1])).toEqual([
      { id: ids[3], position: 0 },
      { id: ids[1], position: 1 },
    ])
  })

  it('writes the returned headline and description onto the item', async () => {
    const ids = await makePhotos([null])
    ok([ids])
    captionItem.mockResolvedValue({
      ok: true,
      value: { headline: 'שולחן עץ', description: 'שני שריטות בפינה.', category: '' , priceAgorot: 0 },
    })

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    const item = await db.item.findUniqueOrThrow({ where: { id: result.itemIds[0] } })
    expect(item.name).toBe('שולחן עץ')
    expect(item.description).toBe('שני שריטות בפינה.')
  })

  it('captions one item per group, each shown only its own photos', async () => {
    const ids = await makePhotos([null, null, null])
    ok([[ids[0], ids[1]], [ids[2]]])

    await clusterBatch(BATCH)

    expect(captionItem).toHaveBeenCalledTimes(2)
    const shown = captionItem.mock.calls.map((call) => call[0].map((image) => image.toString()))
    expect(shown).toEqual([[ids[0], ids[1]], [ids[2]]])
  })

  it('takes the category the model picked, and offers it the seller’s own names', async () => {
    await makeItem()
    const chosen = await db.category.create({ data: { name: 'כלי מטבח', slug: 'kitchen' } })
    const ids = await makePhotos([null])
    ok([ids])
    captionItem.mockResolvedValue({ ok: true, value: { headline: 'סיר', description: 'תיאור', category: 'כלי מטבח' , priceAgorot: 0 } })

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    expect(captionItem.mock.calls[0][1]).toContain('כלי מטבח')
    const item = await db.item.findUniqueOrThrow({ where: { id: result.itemIds[0] } })
    expect(item.categoryId).toBe(chosen.id)
  })

  it('writes the suggested price onto the draft, so the seller edits a number instead of inventing one', async () => {
    await makeItem()
    const ids = await makePhotos([null])
    ok([ids])
    captionItem.mockResolvedValue({
      ok: true,
      value: { headline: 'ספה', description: 'תיאור', category: '', priceAgorot: 45_000 },
    })

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    const item = await db.item.findUniqueOrThrow({ where: { id: result.itemIds[0] } })
    expect(item.priceAgorot).toBe(45_000)
  })

  it('leaves the draft unpriced when the model declined to price it', async () => {
    // 0 is what an unpriced draft already holds, and what the publish guard
    // refuses on — so a model that would not guess leaves the gate closed.
    await makeItem()
    const ids = await makePhotos([null])
    ok([ids])
    captionItem.mockResolvedValue({
      ok: true,
      value: { headline: 'חפץ', description: 'לא ברור', category: '', priceAgorot: 0 },
    })

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    const item = await db.item.findUniqueOrThrow({ where: { id: result.itemIds[0] } })
    expect(item.priceAgorot).toBe(0)
  })

  it('keeps the carried-forward category when the model names none', async () => {
    const previous = await makeItem()
    await db.category.create({ data: { name: 'כלי מטבח', slug: 'kitchen' } })
    const ids = await makePhotos([null])
    ok([ids])
    captionItem.mockResolvedValue({ ok: true, value: { headline: 'סיר', description: 'תיאור', category: '' , priceAgorot: 0 } })

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    const item = await db.item.findUniqueOrThrow({ where: { id: result.itemIds[0] } })
    expect(item.categoryId).toBe(previous.categoryId)
  })

  it('falls back to today plus a fortnight, and a category of its own, in a shop with no items and no sale window', async () => {
    const ids = await makePhotos([null])
    ok([ids])

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    const item = await db.item.findUniqueOrThrow({ where: { id: result.itemIds[0] }, include: { category: true } })
    expect(item.category.name).toBe('כללי')
    expect(item.pickupTo.getTime() - item.pickupFrom.getTime()).toBe(DEFAULT_SALE_DAYS * 86_400_000)
    // Today, never a day that has already gone: the fallback is the one
    // window in the app nobody chose, so it can only ever point forwards.
    expect(item.pickupFrom).toEqual(startOfUtcDay(new Date()))
  })
})

/**
 * Spec §7.4 and its "Running out of credit" section. A clustering failure of
 * any kind means the caption pass never runs — not fewer calls, none. Sixty
 * doomed calls in a row is the failure mode this exists to prevent.
 */
describe('clusterBatch when clustering fails', () => {
  it('attempts no caption at all when the account is out of credit, and still gives every photo an item', async () => {
    const ids = await threeUnstamped()
    clusterPhotos.mockResolvedValue({ ok: false, reason: 'OUT_OF_CREDIT' })

    const result = await clusterBatch(BATCH)

    expect(result).toMatchObject({ ok: true, notice: 'OUT_OF_CREDIT' })
    if (!result.ok) return
    expect(captionItem).toHaveBeenCalledTimes(0)
    await assertEveryPhotoPlaced(ids, result.itemIds)
  })

  it('attempts no caption at all when the call fails, and still gives every photo an item', async () => {
    const ids = await threeUnstamped()
    clusterPhotos.mockResolvedValue({ ok: false, reason: 'FAILED' })

    const result = await clusterBatch(BATCH)

    expect(result).toMatchObject({ ok: true, notice: 'NO_COPY' })
    if (!result.ok) return
    expect(captionItem).toHaveBeenCalledTimes(0)
    await assertEveryPhotoPlaced(ids, result.itemIds)
  })

  it('survives a clustering call that throws, rather than losing the whole batch', async () => {
    // The seam with the worst blast radius: an unhandled rejection here would
    // reject clusterBatch itself, leaving sixty photos with no item at all —
    // invisible to the review screen, reachable only by discarding the batch.
    const ids = await threeUnstamped()
    clusterPhotos.mockRejectedValue(new Error('boom'))

    const result = await clusterBatch(BATCH)

    expect(result).toMatchObject({ ok: true, notice: 'NO_COPY' })
    if (!result.ok) return
    expect(captionItem).toHaveBeenCalledTimes(0)
    await assertEveryPhotoPlaced(ids, result.itemIds)
  })

  it('groups by capture time instead, so photos of one object stay together', async () => {
    const base = Date.UTC(2026, 8, 7, 9, 0, 0)
    const ids = await makePhotos([
      new Date(base),
      new Date(base + 5_000),
      new Date(base + 600_000),
      new Date(base + 605_000),
    ])
    clusterPhotos.mockResolvedValue({ ok: false, reason: 'FAILED' })

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    expect(result.itemIds).toHaveLength(2)
    expect((await photosOf(result.itemIds[0])).map((p) => p.id)).toEqual([ids[0], ids[1]])
    expect((await photosOf(result.itemIds[1])).map((p) => p.id)).toEqual([ids[2], ids[3]])
  })

  it('gives an untimed photo its own item rather than losing it', async () => {
    const base = Date.UTC(2026, 8, 7, 9, 0, 0)
    const ids = await makePhotos([new Date(base), new Date(base + 5_000), null])
    clusterPhotos.mockResolvedValue({ ok: false, reason: 'FAILED' })

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    expect(result.itemIds).toHaveLength(2)
    await assertEveryPhotoPlaced(ids, result.itemIds)
    expect((await photosOf(result.itemIds[1])).map((p) => p.id)).toEqual([ids[2]])
  })

  it('makes no call whatsoever when there is no API key', async () => {
    const ids = await threeUnstamped()
    aiEnabled.mockReturnValue(false)

    const result = await clusterBatch(BATCH)

    expect(result).toMatchObject({ ok: true, notice: 'NO_COPY' })
    if (!result.ok) return
    expect(clusterPhotos).toHaveBeenCalledTimes(0)
    expect(captionItem).toHaveBeenCalledTimes(0)
    await assertEveryPhotoPlaced(ids, result.itemIds)
  })
})

describe('clusterBatch when one caption fails', () => {
  it('empties that item and leaves the others untouched', async () => {
    const ids = await makePhotos([null, null])
    ok([[ids[0]], [ids[1]]])
    captionItem.mockImplementation(async (images) =>
      images[0].toString() === ids[0]
        ? { ok: false, reason: 'FAILED' }
        : { ok: true, value: { headline: 'מנורה', description: 'עובדת.', category: '' , priceAgorot: 0 } },
    )

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    const [failed, fine] = await Promise.all(
      result.itemIds.map((id) => db.item.findUniqueOrThrow({ where: { id } })),
    )
    expect(failed.name).toBe('')
    expect(failed.description).toBe('')
    expect(fine.name).toBe('מנורה')
    expect(fine.description).toBe('עובדת.')
    expect(result.notice).toBe('NO_COPY')
  })

  it('reports credit exhaustion discovered during captioning', async () => {
    const ids = await makePhotos([null, null])
    ok([[ids[0]], [ids[1]]])
    captionItem.mockResolvedValue({ ok: false, reason: 'OUT_OF_CREDIT' })

    const result = await clusterBatch(BATCH)

    expect(result).toMatchObject({ ok: true, notice: 'OUT_OF_CREDIT' })
  })

  it('survives a caption call that throws, without costing the other items their copy', async () => {
    const ids = await makePhotos([null, null])
    ok([[ids[0]], [ids[1]]])
    captionItem.mockImplementation(async (images) => {
      if (images[0].toString() === ids[0]) throw new Error('boom')
      return { ok: true, value: { headline: 'מנורה', description: 'עובדת.', category: '' , priceAgorot: 0 } }
    })

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    const items = await db.item.findMany({ where: { id: { in: result.itemIds } } })
    expect(items.map((i) => i.name).sort()).toEqual(['', 'מנורה'])
  })
})

describe('clusterBatch and the photos it may touch', () => {
  it('refuses a batch with nothing left to cluster', async () => {
    const result = await clusterBatch('no-such-batch')

    expect(result).toEqual({ ok: false, error: 'לא נמצאו תמונות לייבוא.' })
    expect(clusterPhotos).toHaveBeenCalledTimes(0)
  })

  it('leaves a photo that already has an item alone', async () => {
    const existing = await makeItem()
    const ids = await makePhotos([null, null])
    await db.photo.update({ where: { id: ids[0] }, data: { itemId: existing.id } })
    ok([[ids[1]]])

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    expect(clusterPhotos.mock.calls[0][0].map((p) => p.id)).toEqual([ids[1]])
    expect(result.itemIds).not.toContain(existing.id)
    const untouched = await db.photo.findUniqueOrThrow({ where: { id: ids[0] } })
    expect(untouched.itemId).toBe(existing.id)
  })

  it('adopts a photo the grouping left out, rather than stranding it', async () => {
    const ids = await makePhotos([null, null, null])
    // Not something clusterPhotos can return — it accounts for every photo —
    // but the seller loses a photo to the review screen if this is ever wrong.
    ok([[ids[0]]])

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    expect(result.itemIds).toHaveLength(3)
    await assertEveryPhotoPlaced(ids, result.itemIds)
  })

  it('places a photo named by two groups onto one item only', async () => {
    const ids = await makePhotos([null, null])
    ok([[ids[0], ids[1]], [ids[1]]])

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    expect(result.itemIds).toHaveLength(1)
    expect(await photosOf(result.itemIds[0])).toEqual([
      { id: ids[0], position: 0 },
      { id: ids[1], position: 1 },
    ])
  })

  it('places a photo named twice by one group once, numbered from zero', async () => {
    const ids = await makePhotos([null, null])
    ok([[ids[0], ids[0], ids[1]]])

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    expect(result.itemIds).toHaveLength(1)
    expect(await photosOf(result.itemIds[0])).toEqual([
      { id: ids[0], position: 0 },
      { id: ids[1], position: 1 },
    ])
  })

  it('still gives an item to a photo whose file has gone missing', async () => {
    const ids = await makePhotos([null, null])
    await rm(photoDir(ids[0]), { recursive: true, force: true })
    ok([[ids[1]]])

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    expect(clusterPhotos.mock.calls[0][0].map((p) => p.id)).toEqual([ids[1]])
    await assertEveryPhotoPlaced(ids, result.itemIds)
  })

  it('makes no call when not one file can be read, and still creates the items', async () => {
    const ids = await threeUnstamped()
    for (const id of ids) await rm(photoDir(id), { recursive: true, force: true })

    const result = await clusterBatch(BATCH)

    expect(result).toMatchObject({ ok: true, notice: 'NO_COPY' })
    if (!result.ok) return
    expect(clusterPhotos).toHaveBeenCalledTimes(0)
    expect(captionItem).toHaveBeenCalledTimes(0)
    await assertEveryPhotoPlaced(ids, result.itemIds)
  })
})

describe('clusterBatch and the categories a caption proposes', () => {
  it('creates a category the model proposed, so the item is not left on the default', async () => {
    // Before this, a proposed name simply was not in the id map and the item
    // silently kept the carried-forward default — the suggestion was made and
    // then thrown away, which is worse than not making it.
    const ids = await makePhotos([null])
    clusterPhotos.mockResolvedValue({ ok: true, value: [[ids[0]]] })
    captionItem.mockResolvedValue({
      ok: true,
      value: { headline: 'אופני הרים', description: 'שלדה אפורה.', category: 'ספורט' , priceAgorot: 0 },
    })

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    const created = await db.category.findUnique({ where: { name: 'ספורט' } })
    expect(created).not.toBeNull()

    const item = await db.item.findUniqueOrThrow({
      where: { id: result.itemIds[0] },
      include: { category: true },
    })
    expect(item.category.name).toBe('ספורט')
  })

  it('does not create a second category when two items propose the same new name', async () => {
    // Captions run in parallel, so this really can happen on one drop. `name`
    // is unique; the loser's P2002 is the answer, not a failure.
    const ids = await makePhotos([null, null])
    clusterPhotos.mockResolvedValue({ ok: true, value: [[ids[0]], [ids[1]]] })
    captionItem.mockResolvedValue({
      ok: true,
      value: { headline: 'פריט', description: 'תיאור.', category: 'כלי גינה' , priceAgorot: 0 },
    })

    const result = await clusterBatch(BATCH)
    if (!result.ok) throw new Error('expected ok')

    expect(await db.category.count({ where: { name: 'כלי גינה' } })).toBe(1)
    const items = await db.item.findMany({
      where: { id: { in: result.itemIds } },
      include: { category: true },
    })
    expect(items.map((i) => i.category.name)).toEqual(['כלי גינה', 'כלי גינה'])
  })
})

/**
 * The same caption pass, aimed at one card: what `movePhoto(photoId, 'new')`
 * fires once the seller has split a wrongly clustered group. Before it, that
 * card arrived named "פריט חדש" with nothing else on it, and everything the
 * model could read off the photograph was retyped by hand.
 */
describe('suggestForItem', () => {
  /** A DRAFT with one photo on it, the way a move-to-new leaves things. */
  async function draftWithPhoto() {
    const item = await makeItem({ status: ItemStatus.DRAFT })
    const [photoId] = await makePhotos([null])
    await db.photo.update({ where: { id: photoId }, data: { itemId: item.id, position: 0 } })
    return item
  }

  it('writes the name, description, category and price onto the card, and hands them back', async () => {
    await db.category.create({ data: { name: 'ריהוט', slug: 'rihut' } })
    const item = await draftWithPhoto()
    captionItem.mockResolvedValue({
      ok: true,
      value: { headline: 'כורסה', description: 'נוחה מאוד.', category: 'ריהוט', priceAgorot: 25_000 },
    })

    const result = await suggestForItem(item.id)

    expect(result).toEqual({
      ok: true,
      suggestion: { name: 'כורסה', description: 'נוחה מאוד.', price: '250', categoryName: 'ריהוט' },
    })
    const saved = await db.item.findUniqueOrThrow({ where: { id: item.id }, include: { category: true } })
    expect(saved.name).toBe('כורסה')
    expect(saved.priceAgorot).toBe(25_000)
    expect(saved.category.name).toBe('ריהוט')
  })

  it('reports the stored values, not the model\'s — that is what the screen fills in', async () => {
    // The seller's own spelling of a category wins over the model's, and the
    // price is the rounded one. Reading back after the write is what keeps the
    // fields on screen equal to the row, so no save is owed.
    const item = await draftWithPhoto()
    captionItem.mockResolvedValue({
      ok: true,
      value: { headline: '  שולחן  ', description: 'עץ מלא.', category: '', priceAgorot: 0 },
    })

    const result = await suggestForItem(item.id)
    if (!result.ok) throw new Error('expected a suggestion')

    const saved = await db.item.findUniqueOrThrow({ where: { id: item.id } })
    expect(result.suggestion.name).toBe(saved.name)
    // 0 agorot is "unpriced", and the price field holds '' for that, never '0'.
    expect(result.suggestion.price).toBe('')
  })

  it('shows the model every photo on the card and offers it the seller\'s categories', async () => {
    await db.category.create({ data: { name: 'ריהוט', slug: 'rihut2' } })
    const item = await draftWithPhoto()

    await suggestForItem(item.id)

    expect(captionItem).toHaveBeenCalledTimes(1)
    expect(captionItem.mock.calls[0][0]).toHaveLength(1)
    expect(captionItem.mock.calls[0][1]).toContain('ריהוט')
  })

  it('makes no call at all when no key is configured', async () => {
    aiEnabled.mockReturnValue(false)
    const item = await draftWithPhoto()

    expect(await suggestForItem(item.id)).toEqual({ ok: false, reason: 'NO_KEY' })
    expect(captionItem).not.toHaveBeenCalled()
  })

  it('makes no call for a card with no photographs — there is nothing to show', async () => {
    const item = await makeItem({ status: ItemStatus.DRAFT })

    expect(await suggestForItem(item.id)).toEqual({ ok: false, reason: 'FAILED' })
    expect(captionItem).not.toHaveBeenCalled()
  })

  it('reports a missing item rather than throwing at the seller mid-correction', async () => {
    expect(await suggestForItem('no-such-item')).toEqual({ ok: false, reason: 'FAILED' })
  })

  it('passes the credit failure through, so the screen can stay quiet about it', async () => {
    const item = await draftWithPhoto()
    captionItem.mockResolvedValue({ ok: false, reason: 'OUT_OF_CREDIT' })

    expect(await suggestForItem(item.id)).toEqual({ ok: false, reason: 'OUT_OF_CREDIT' })
  })

  it('does not throw when the model call itself throws', async () => {
    const item = await draftWithPhoto()
    captionItem.mockRejectedValue(new Error('socket hang up'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await suggestForItem(item.id)).toEqual({ ok: false, reason: 'FAILED' })
  })
})
