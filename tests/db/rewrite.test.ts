import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ItemStatus } from '@prisma/client'
import type { AiResult, Caption } from '@/lib/ai/types'

/**
 * The AI client is mocked, as everywhere on this path: no test in this project
 * may reach the real API — the product owner pays for every call, and this is
 * the one feature that makes one call per item in the shop.
 */
const { captionItem, aiEnabled } = vi.hoisted(() => ({
  captionItem: vi.fn<(images: Buffer[], categories: string[]) => Promise<AiResult<Caption>>>(),
  aiEnabled: vi.fn<() => boolean>(),
}))

vi.mock('@/lib/ai/client', () => ({ captionItem, aiEnabled, clusterPhotos: vi.fn() }))

import { db } from '@/lib/db'
import { photoDir, photoFilename } from '@/lib/images'
import { rewriteDescriptions, rewriteCounts } from '@/lib/import/rewrite'
import { resetDb } from '../helpers/db'
import { makeItem } from '../helpers/factories'

let dir: string

beforeEach(async () => {
  await resetDb()
  dir = await mkdtemp(path.join(tmpdir(), 'ys-rewrite-'))
  process.env.UPLOAD_DIR = dir

  captionItem.mockReset()
  aiEnabled.mockReset()
  aiEnabled.mockReturnValue(true)
  captionItem.mockResolvedValue({
    ok: true,
    value: { headline: 'כותרת חדשה', description: 'תיאור חדש.', category: 'קטגוריה חדשה', priceAgorot: 90_000 },
  })
})

afterEach(() => rm(dir, { recursive: true, force: true }))

/** An item with one readable 400px file, which is what a model call needs. */
async function itemWithPhoto(overrides: Parameters<typeof makeItem>[0] = {}) {
  const item = await makeItem(overrides)
  const photo = await db.photo.create({
    data: { itemId: item.id, width: 800, height: 600, lqip: 'x', position: 0 },
  })
  await mkdir(photoDir(photo.id), { recursive: true })
  await writeFile(path.join(photoDir(photo.id), photoFilename(400)), photo.id)
  return item
}

const descriptionOf = async (id: string) => (await db.item.findUniqueOrThrow({ where: { id } })).description

describe('rewriteCounts', () => {
  it('counts what a rewrite would touch, and what it would pass over', async () => {
    await itemWithPhoto()
    await itemWithPhoto({ status: ItemStatus.SOLD })
    await makeItem() // no photograph: nothing to show the model

    expect(await rewriteCounts()).toEqual({ rewritable: 1, skipped: 2 })
  })
})

describe('rewriteDescriptions', () => {
  it('replaces the description and leaves the name, category and price alone', async () => {
    // The whole safety property of this action. The seller chose those three,
    // and buyers have already seen them on the shop.
    const item = await itemWithPhoto({ priceAgorot: 12_345 })
    const before = await db.item.findUniqueOrThrow({ where: { id: item.id } })

    expect(await rewriteDescriptions()).toEqual({ ok: true, rewritten: 1, failed: 0, reason: null })

    const after = await db.item.findUniqueOrThrow({ where: { id: item.id } })
    expect(after.description).toBe('תיאור חדש.')
    expect(after.name).toBe(before.name)
    expect(after.priceAgorot).toBe(before.priceAgorot)
    expect(after.categoryId).toBe(before.categoryId)
  })

  it('never touches a sold item — its listing is history and its call costs money', async () => {
    const sold = await itemWithPhoto({ status: ItemStatus.SOLD })
    const before = await descriptionOf(sold.id)

    expect(await rewriteDescriptions()).toEqual({ ok: true, rewritten: 0, failed: 0, reason: null })
    expect(await descriptionOf(sold.id)).toBe(before)
    expect(captionItem).not.toHaveBeenCalled()
  })

  it('rewrites a hidden item — the seller means to show it again', async () => {
    const hidden = await itemWithPhoto({ status: ItemStatus.HIDDEN })

    expect(await rewriteDescriptions()).toMatchObject({ rewritten: 1 })
    expect(await descriptionOf(hidden.id)).toBe('תיאור חדש.')
  })

  it('makes no call for an item with no photograph', async () => {
    await makeItem()

    expect(await rewriteDescriptions()).toEqual({ ok: true, rewritten: 0, failed: 0, reason: null })
    expect(captionItem).not.toHaveBeenCalled()
  })

  it('keeps the old description when the model answers with nothing', async () => {
    // An empty answer is not an improvement, and a buyer is reading the field
    // it would have replaced.
    const item = await itemWithPhoto()
    const before = await descriptionOf(item.id)
    captionItem.mockResolvedValue({
      ok: true,
      value: { headline: 'x', description: '   ', category: '', priceAgorot: 0 },
    })

    expect(await rewriteDescriptions()).toEqual({ ok: true, rewritten: 0, failed: 1, reason: 'FAILED' })
    expect(await descriptionOf(item.id)).toBe(before)
  })

  it('keeps the old description when the call fails', async () => {
    const item = await itemWithPhoto()
    const before = await descriptionOf(item.id)
    captionItem.mockResolvedValue({ ok: false, reason: 'FAILED' })

    expect(await rewriteDescriptions()).toEqual({ ok: true, rewritten: 0, failed: 1, reason: 'FAILED' })
    expect(await descriptionOf(item.id)).toBe(before)
  })

  it('stops as soon as the account runs dry, instead of spending the wait on doomed calls', async () => {
    for (let i = 0; i < 9; i++) await itemWithPhoto()
    captionItem.mockResolvedValue({ ok: false, reason: 'OUT_OF_CREDIT' })

    const result = await rewriteDescriptions()

    expect(result).toMatchObject({ ok: true, rewritten: 0, reason: 'OUT_OF_CREDIT' })
    // One batch of four, then the break — not all nine.
    expect(captionItem.mock.calls.length).toBeLessThan(9)
  })

  it('reports the credit failure over an ordinary one, because it is the one to act on', async () => {
    await itemWithPhoto()
    await itemWithPhoto()
    captionItem
      .mockResolvedValueOnce({ ok: false, reason: 'FAILED' })
      .mockResolvedValueOnce({ ok: false, reason: 'OUT_OF_CREDIT' })

    expect(await rewriteDescriptions()).toMatchObject({ reason: 'OUT_OF_CREDIT' })
  })

  it('refuses in words, without a call, when no key is configured', async () => {
    aiEnabled.mockReturnValue(false)
    await itemWithPhoto()

    const result = await rewriteDescriptions()
    expect(result.ok).toBe(false)
    expect(captionItem).not.toHaveBeenCalled()
  })

  it('offers the model the seller’s categories, so its copy speaks the shop’s language', async () => {
    await db.category.create({ data: { name: 'ריהוט', slug: 'rihut-rewrite' } })
    await itemWithPhoto()

    await rewriteDescriptions()

    expect(captionItem.mock.calls[0][1]).toContain('ריהוט')
  })

  it('does nothing, and says so, on an empty shop', async () => {
    expect(await rewriteDescriptions()).toEqual({ ok: true, rewritten: 0, failed: 0, reason: null })
  })
})
