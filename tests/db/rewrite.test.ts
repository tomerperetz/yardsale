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
import { rewriteDescriptions, rewriteCount } from '@/lib/import/rewrite'
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

describe('rewriteCount', () => {
  it('counts what a rewrite would touch, and nothing it would not', async () => {
    await itemWithPhoto()
    await itemWithPhoto({ status: ItemStatus.SOLD })
    await itemWithPhoto({ status: ItemStatus.DRAFT })
    await makeItem() // no photograph: nothing to show the model

    expect(await rewriteCount()).toBe(1)
  })
})

describe('rewriteDescriptions', () => {
  it('replaces the description and leaves the name, category and price alone', async () => {
    // The whole safety property of this action. The seller chose those three,
    // and buyers have already seen them on the shop.
    const item = await itemWithPhoto({ priceAgorot: 12_345 })
    const before = await db.item.findUniqueOrThrow({ where: { id: item.id } })

    expect(await rewriteDescriptions()).toEqual({ ok: true, rewritten: 1, failed: 0, remaining: 0, reason: null })

    const after = await db.item.findUniqueOrThrow({ where: { id: item.id } })
    expect(after.description).toBe('תיאור חדש.')
    expect(after.name).toBe(before.name)
    expect(after.priceAgorot).toBe(before.priceAgorot)
    expect(after.categoryId).toBe(before.categoryId)
  })

  it('never touches a sold item — its listing is history and its call costs money', async () => {
    const sold = await itemWithPhoto({ status: ItemStatus.SOLD })
    const before = await descriptionOf(sold.id)

    expect(await rewriteDescriptions()).toEqual({ ok: true, rewritten: 0, failed: 0, remaining: 0, reason: null })
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

    expect(await rewriteDescriptions()).toEqual({ ok: true, rewritten: 0, failed: 0, remaining: 0, reason: null })
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

    expect(await rewriteDescriptions()).toMatchObject({ ok: true, rewritten: 0, failed: 1, reason: 'FAILED' })
    expect(await descriptionOf(item.id)).toBe(before)
  })

  it('keeps the old description when the call fails', async () => {
    const item = await itemWithPhoto()
    const before = await descriptionOf(item.id)
    captionItem.mockResolvedValue({ ok: false, reason: 'FAILED' })

    expect(await rewriteDescriptions()).toMatchObject({ ok: true, rewritten: 0, failed: 1, reason: 'FAILED' })
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
    expect(await rewriteDescriptions()).toEqual({ ok: true, rewritten: 0, failed: 0, remaining: 0, reason: null })
  })

  it('caps one press at twelve items and says how many are left', async () => {
    // A caption call is ten to fifteen seconds. Sixty in one server action is
    // minutes in a single request, which proxies cut — and the seller then
    // sees "try again" for a call that is still running and still billing.
    for (let i = 0; i < 15; i++) await itemWithPhoto()

    const result = await rewriteDescriptions()

    expect(result).toMatchObject({ ok: true, rewritten: 12, remaining: 3 })
    expect(captionItem).toHaveBeenCalledTimes(12)
  })

  it('continues where it left off when pressed again, instead of buying the same twelve twice', async () => {
    for (let i = 0; i < 15; i++) await itemWithPhoto()

    await rewriteDescriptions()
    captionItem.mockClear()
    const second = await rewriteDescriptions()

    expect(second).toMatchObject({ ok: true, rewritten: 3, remaining: 0 })
    expect(captionItem).toHaveBeenCalledTimes(3)
  })

  it('never offers an item a model has already written', async () => {
    const item = await itemWithPhoto()
    await rewriteDescriptions()

    expect(await rewriteCount()).toBe(0)
    captionItem.mockClear()
    expect(await rewriteDescriptions()).toMatchObject({ rewritten: 0, remaining: 0 })
    expect(captionItem).not.toHaveBeenCalled()
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).descriptionWrittenAt).not.toBeNull()
  })

  it('offers an item again after ONE failure — a network blip deserves a retry', async () => {
    await itemWithPhoto()
    captionItem.mockResolvedValue({ ok: false, reason: 'FAILED' })
    await rewriteDescriptions()

    expect(await rewriteCount()).toBe(1)
  })

  it('stops offering an item the model will never describe, instead of billing it forever', async () => {
    // Selection is deterministic, so without a cap the one item that always
    // fails is picked FIRST on every press, paid for every time, while the
    // screen goes on saying "press again to continue" and `remaining` never
    // reaches zero. The seller obeys. This is that loop, closed.
    await itemWithPhoto()
    captionItem.mockResolvedValue({ ok: false, reason: 'FAILED' })

    await rewriteDescriptions()
    await rewriteDescriptions()
    captionItem.mockClear()

    expect(await rewriteCount()).toBe(0)
    expect(await rewriteDescriptions()).toMatchObject({ rewritten: 0, remaining: 0 })
    expect(captionItem).not.toHaveBeenCalled()
  })

  it('reaches zero remaining even with a deterministically-failing item at the front of the queue', async () => {
    // The reviewer's exact scenario. 13 items; the NEWEST is a photograph the
    // model always answers about with an empty description, so `createdAt
    // desc` picks it first on every press. Without a cap: every press bills it
    // again, `remaining` sticks, and `doneMessage` goes on printing
    // "נשארו פריט אחד — לחצו שוב להמשך" — the screen instructing the seller to
    // repeat a call that cannot succeed.
    const older = []
    for (let i = 0; i < 12; i++) older.push(await itemWithPhoto())
    const doomed = await itemWithPhoto() // newest, so selected first

    // The stored file's bytes are the photo's own id (see `itemWithPhoto`),
    // which is how this tells which item a given call is looking at.
    const doomedPhotoId = (await db.photo.findFirstOrThrow({ where: { itemId: doomed.id } })).id
    captionItem.mockImplementation(async (images) => {
      const showsDoomed = images.some((image) => image.toString() === doomedPhotoId)
      return showsDoomed
        ? { ok: true, value: { headline: 'x', description: '', category: '', priceAgorot: 0 } }
        : { ok: true, value: { headline: 'x', description: 'תיאור חדש.', category: '', priceAgorot: 0 } }
    })

    // Press until it says there is nothing left — and cap the loop, because
    // "it never terminates" is the bug under test and a test that hangs is
    // not a report.
    let presses = 0
    let remaining = Infinity
    while (remaining !== 0 && presses < 10) {
      const result = await rewriteDescriptions()
      if (!result.ok) throw new Error(result.error)
      remaining = result.remaining
      presses++
    }

    expect(remaining).toBe(0)
    expect(presses).toBeLessThanOrEqual(3)

    // The twelve good ones got their copy; the doomed one kept what it had.
    expect(await db.item.count({ where: { descriptionWrittenAt: { not: null } } })).toBe(12)
    expect(await descriptionOf(doomed.id)).toBe('תיאור')

    // And pressing once more spends nothing at all.
    captionItem.mockClear()
    expect(await rewriteDescriptions()).toMatchObject({ rewritten: 0, remaining: 0 })
    expect(captionItem).not.toHaveBeenCalled()
    expect(older).toHaveLength(12)
  })

  it('counts an empty answer as a spent attempt — the call was paid for', async () => {
    await itemWithPhoto()
    captionItem.mockResolvedValue({
      ok: true,
      value: { headline: 'x', description: '   ', category: '', priceAgorot: 0 },
    })

    await rewriteDescriptions()
    await rewriteDescriptions()

    expect(await rewriteCount()).toBe(0)
  })

  it('retires an item whose photo files have gone, without ever calling the model', async () => {
    // Free to discover, but it can never succeed, and leaving it in the queue
    // is what keeps the screen asking for one more press.
    const item = await makeItem()
    await db.photo.create({ data: { itemId: item.id, width: 8, height: 6, lqip: 'x', position: 0 } })

    await rewriteDescriptions()
    await rewriteDescriptions()

    expect(captionItem).not.toHaveBeenCalled()
    expect(await rewriteCount()).toBe(0)
  })

  it.each(['UNAVAILABLE', 'NO_KEY'] as const)(
    'never burns an attempt on %s — the call never reached the model',
    async (reason) => {
      // The inverse risk of the cap, and the worse one. Twenty minutes of
      // Anthropic 529s, a seller who presses through it because the screen
      // said "press again", and every item is retired at two attempts — from
      // the one feature that exists for them, permanently, because nothing in
      // the app resets the counter and only a success clears it.
      await itemWithPhoto()
      captionItem.mockResolvedValue({ ok: false, reason })

      await rewriteDescriptions()
      await rewriteDescriptions()
      await rewriteDescriptions()

      expect(await rewriteCount()).toBe(1)
    },
  )

  it('stops the batch on an outage rather than hammering a service that is not there', async () => {
    for (let i = 0; i < 9; i++) await itemWithPhoto()
    captionItem.mockResolvedValue({ ok: false, reason: 'UNAVAILABLE' })

    const result = await rewriteDescriptions()

    expect(result).toMatchObject({ reason: 'UNAVAILABLE' })
    expect(captionItem.mock.calls.length).toBeLessThan(9)
  })

  it('never burns an attempt on running out of credit — the model never saw the item', async () => {
    // Otherwise topping up the account would find half the shop quietly
    // retired by failures that said nothing about the items themselves.
    await itemWithPhoto()
    captionItem.mockResolvedValue({ ok: false, reason: 'OUT_OF_CREDIT' })

    await rewriteDescriptions()
    await rewriteDescriptions()
    await rewriteDescriptions()

    expect(await rewriteCount()).toBe(1)
  })

  it('clears the attempts once an item finally gets its description', async () => {
    const item = await itemWithPhoto()
    captionItem.mockResolvedValue({ ok: false, reason: 'FAILED' })
    await rewriteDescriptions()

    captionItem.mockResolvedValue({
      ok: true,
      value: { headline: 'x', description: 'תיאור חדש.', category: '', priceAgorot: 0 },
    })
    await rewriteDescriptions()

    const saved = await db.item.findUniqueOrThrow({ where: { id: item.id } })
    expect(saved.descriptionAttempts).toBe(0)
    expect(saved.descriptionWrittenAt).not.toBeNull()
  })

  it('never touches a DRAFT — the import just wrote it, from the same prompt and the same photos', async () => {
    // Otherwise a seller who imports 40 photos and then presses this pays for
    // 40 more calls, and the review screen writes its own state back over the
    // result on publish, so the money buys nothing at all.
    await itemWithPhoto({ status: ItemStatus.DRAFT })

    expect(await rewriteCount()).toBe(0)
    expect(await rewriteDescriptions()).toMatchObject({ rewritten: 0 })
    expect(captionItem).not.toHaveBeenCalled()
  })

  it('refuses a second press while the first is still running', async () => {
    // The button's `busy` flag is client state, and a proxy that cuts the
    // first request clears it while the server is still billing. Pressing
    // again must not start a second pass over the same items.
    await itemWithPhoto()
    let release = () => {}
    captionItem.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ ok: false, reason: 'FAILED' }) }),
    )

    const first = rewriteDescriptions()
    // Let the first call reach the model before pressing again.
    await new Promise((r) => setTimeout(r, 20))
    const second = await rewriteDescriptions()

    expect(second.ok).toBe(false)
    release()
    await first
  })

  it('accepts a press again once the previous one has finished', async () => {
    await itemWithPhoto()
    await rewriteDescriptions()
    await itemWithPhoto()

    expect(await rewriteDescriptions()).toMatchObject({ ok: true, rewritten: 1 })
  })
})
