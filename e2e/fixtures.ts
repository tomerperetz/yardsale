import 'dotenv/config'
import type { BrowserContext, Page } from '@playwright/test'
import sharp from 'sharp'
import { ItemStatus, OrderStatus, PickupSlot, type Settings } from '@prisma/client'
import { db } from '../src/lib/db'
import { reserveItems, type ReserveResult } from '../src/lib/orders/reserve'
import { newOrderCode, newOrderToken } from '../src/lib/orders/codes'
import { utcDate } from '../src/lib/dates'
import { hebrewSlug, randomSuffix } from '../src/lib/slug'
import { deletePhotoFiles } from '../src/lib/images'
import { IMPORT_CHUNK_FILES } from '../src/lib/photo-url'
import { SESSION_COOKIE, signSession } from '../src/lib/auth'
import { BASE_URL } from '../playwright.config'

// Mixes in the pid as well as a counter and Date.now(): playwright.config.ts
// pins this whole run to a single worker (Settings, below, is a shared
// singleton row that can't tolerate concurrent tests), so nothing here truly
// races today — but it costs nothing to make names collision-proof against a
// leftover row from a previous interrupted run or a differently-configured
// invocation, the same way tests/helpers/factories.ts's uniq() does within
// vitest's one process.
let n = 0
const uniq = () => `${Date.now()}-${process.pid}-${n++}`

type SettingsOverrides = Partial<
  Pick<
    Settings,
    | 'shopName'
    | 'tagline'
    | 'bitPhone'
    | 'addressLine'
    | 'city'
    | 'slotMorning'
    | 'slotAfternoon'
    | 'slotEvening'
    | 'holdMinutes'
  >
>

/**
 * Ensures the Settings singleton (id=1) exists and resets it to a known
 * "open for business" baseline, then applies overrides — the same pattern
 * tests/db/reserve.test.ts already uses (`openShop()`), since Settings has
 * exactly one row shared by the whole database.
 *
 * Upserts that one row directly rather than calling prisma/seed.ts's own
 * seed() — this suite only needs Settings to exist with specific field
 * values, and on a database shared with other concurrent work (see
 * cleanupItems/cleanupOrders below for the same reasoning about Item/Order),
 * one targeted write per test keeps this to exactly what it depends on
 * rather than re-running the whole project seed a dozen times per run.
 */
export async function seedShop(overrides: SettingsOverrides = {}): Promise<void> {
  const data = {
    shopName: 'חצר של דנה',
    tagline: 'הכל חייב לצאת עד יום ראשון',
    bitPhone: '0501234567',
    addressLine: 'הרצל 12',
    city: 'תל אביב',
    slotMorning: '',
    slotAfternoon: '',
    slotEvening: '',
    holdMinutes: 15,
    dismissedMerges: [] as string[],
    ...overrides,
  }
  await db.settings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  })
}

async function categoryByName(name: string) {
  // Category.name/slug are globally unique; a fixed Hebrew name (the buyer
  // spec needs one the UI shows verbatim, e.g. for a filter link) has to be
  // upserted, not created, or a second test run collides with the first.
  return db.category.upsert({ where: { name }, update: {}, create: { name, slug: name } })
}

export type AvailableItemInput = {
  name: string
  price: number
  category: string
  pickupFrom?: Date
  pickupTo?: Date
}

/**
 * An AVAILABLE item with a caller-chosen name/price/category — unlike
 * tests/helpers/factories.ts's makeItem (generic name, category by id), the
 * buyer journey needs to assert on specific visible text. The stored name
 * always carries a unique suffix so two concurrent runs (again: desktop +
 * mobile) never produce two items with an identical, ambiguous accessible
 * name on the same shared grid.
 */
export async function makeAvailableItem(input: AvailableItemInput) {
  const category = await categoryByName(input.category)
  const s = uniq()
  return db.item.create({
    data: {
      slug: `e2e-${s}`,
      name: `${input.name} ${s}`,
      description: 'פריט לבדיקה אוטומטית של המערכת',
      priceAgorot: input.price,
      categoryId: category.id,
      pickupFrom: input.pickupFrom ?? utcDate(2026, 9, 12),
      pickupTo: input.pickupTo ?? utcDate(2026, 9, 18),
      status: ItemStatus.AVAILABLE,
    },
  })
}

/**
 * Same as `makeAvailableItem`, but the slug is the app's real `hebrewSlug`
 * output instead of every other fixture item's ASCII `e2e-<n>` shortcut.
 * Needed to exercise an actual Hebrew, percent-encoded-in-the-URL slug —
 * see task-14 fix round 2, where every real (hebrewSlug-generated) item
 * page 404'd and this suite's own ASCII-slugged fixtures never caught it.
 */
export async function makeAvailableItemWithHebrewSlug(input: AvailableItemInput) {
  const category = await categoryByName(input.category)
  const s = uniq()
  const name = `${input.name} ${s}`
  return db.item.create({
    data: {
      slug: hebrewSlug(name, randomSuffix()),
      name,
      description: 'פריט לבדיקה אוטומטית של המערכת',
      priceAgorot: input.price,
      categoryId: category.id,
      pickupFrom: input.pickupFrom ?? utcDate(2026, 9, 12),
      pickupTo: input.pickupTo ?? utcDate(2026, 9, 18),
      status: ItemStatus.AVAILABLE,
    },
  })
}

/**
 * Simulates a second buyer completing checkout for `itemId` — used by the
 * race spec to reserve the item out of band, between this test's page load
 * and its own submit. Goes through the real reserveItems (the same atomic
 * claim a UI checkout uses), so this is a genuine competing reservation,
 * not a status-flip shortcut.
 */
export async function reserveOutOfBand(itemId: string): Promise<Extract<ReserveResult, { ok: true }>> {
  const result = await reserveItems({
    itemIds: [itemId],
    buyerName: 'קונה מתחרה',
    buyerPhone: '0509998888',
    pickupDate: utcDate(2026, 9, 15),
    pickupSlot: PickupSlot.AFTERNOON,
  })
  if (!result.ok) throw new Error(`reserveOutOfBand: expected to win the item, got ${JSON.stringify(result)}`)
  return result
}

export type ClaimedOrderInput = { name: string; price: number; category: string }

/**
 * An order already at CLAIMED_PAID (its item RESERVED, hold already
 * stopped) — what the admin "confirm payment" screen needs as a starting
 * point. Built directly rather than via reserveItems+claimPaid (which would
 * need a real hold window) or tests/helpers/factories.ts's makeOrder, whose
 * `code` is a bare per-process counter ("YS-1000", "YS-1001", ...) with no
 * timestamp or pid mixed in — safe under vitest's single process, but two
 * Playwright projects (or a differently-configured, parallel run of this
 * suite) both start that counter at 0 and would race to insert the same
 * unique `code`. Uses the app's own newOrderCode()/newOrderToken()
 * (crypto-random) instead.
 */
export async function makeClaimedOrder(input: ClaimedOrderInput) {
  const category = await categoryByName(input.category)
  const s = uniq()
  const item = await db.item.create({
    data: {
      slug: `e2e-${s}`,
      name: `${input.name} ${s}`,
      description: 'פריט לבדיקה אוטומטית של המערכת',
      priceAgorot: input.price,
      categoryId: category.id,
      pickupFrom: utcDate(2026, 9, 12),
      pickupTo: utcDate(2026, 9, 18),
      status: ItemStatus.RESERVED,
    },
  })
  const order = await db.order.create({
    data: {
      code: newOrderCode(),
      token: newOrderToken(),
      buyerName: 'קונה קלוד',
      buyerPhone: '0501112233',
      status: OrderStatus.CLAIMED_PAID,
      pickupDate: utcDate(2026, 9, 15),
      pickupSlot: PickupSlot.AFTERNOON,
      totalAgorot: item.priceAgorot,
      holdExpiresAt: null,
      claimedAt: new Date(),
      items: { create: [{ itemId: item.id, priceAgorot: item.priceAgorot }] },
    },
  })
  return { item, order }
}

/** Deletes orders by token — cascades their OrderItem rows. Must run BEFORE cleanupItems, or a still-referenced item 409s on delete. */
export async function cleanupOrders(tokens: (string | undefined)[]): Promise<void> {
  const live = tokens.filter((t): t is string => !!t)
  if (live.length > 0) await db.order.deleteMany({ where: { token: { in: live } } })
}

/** Deletes items by id — cascades their Photo rows (none in this suite, but harmless). Call after cleanupOrders. */
export async function cleanupItems(ids: (string | undefined)[]): Promise<void> {
  const live = ids.filter((id): id is string => !!id)
  if (live.length > 0) await db.item.deleteMany({ where: { id: { in: live } } })
}

/** The plaintext behind .env's ADMIN_PASSWORD_HASH — kept out of spec files themselves, see .env's comment. */
export function adminTestPassword(): string {
  const p = process.env.E2E_ADMIN_PASSWORD
  if (!p) throw new Error('E2E_ADMIN_PASSWORD is not set — see .env / .env.example')
  return p
}

export type ImportDropPhoto = {
  /** The EXIF capture time the client would have read off the file. Photos within 30s of each other group together — see groupByCaptureTime. */
  takenAt: Date
}

export type ImportDropResult = {
  batchId: string
  /** The stored photo ids, in the order they were dropped. */
  photoIds: string[]
  /** How many POSTs it took — one per IMPORT_CHUNK_FILES photos. */
  chunks: number
}

/**
 * Drops photos into an import batch the way ImportDrop.tsx's own `upload()`
 * does: the same endpoint, the same `files`/`takenAt` field pairs, and the
 * same one-request-at-a-time cadence, from a signed-in page so the request
 * carries the session cookie through src/middleware.ts.
 *
 * Posted from inside the browser rather than through Playwright's request
 * fixture because the multipart body a real drop produces is the browser's,
 * and this route's alignment of `files` with `takenAt` depends on the order
 * that encoder preserves.
 *
 * Why the spec cannot simply drive the drop zone: `/admin/items?mode=bulk`
 * only renders ImportDrop when ANTHROPIC_API_KEY is set (BulkQueue.tsx), and
 * this suite deliberately runs with it empty — see playwright.config.ts. The
 * review screen everything after this touches is the real UI.
 *
 * SEQUENTIAL ON PURPOSE (spec §7.1): each request numbers its photos from what
 * the batch already holds, so two in flight read the same count and collide.
 * Posting them concurrently here would reproduce the very bug the spec that
 * uses this asserts is gone.
 *
 * @param joinBatchId adds to an existing batch, as every chunk after the first does.
 */
export async function dropImportPhotos(
  page: Page,
  photos: ImportDropPhoto[],
  joinBatchId?: string,
): Promise<ImportDropResult> {
  const encoded = await Promise.all(
    photos.map(async (photo, i) => ({
      base64: (await testJpeg(i)).toString('base64'),
      takenAt: photo.takenAt.toISOString(),
    })),
  )

  let batchId = joinBatchId ?? null
  const photoIds: string[] = []
  let chunks = 0

  for (let i = 0; i < encoded.length; i += IMPORT_CHUNK_FILES) {
    const chunk = encoded.slice(i, i + IMPORT_CHUNK_FILES)

    const result = await page.evaluate(
      async ({ chunk, batchId }) => {
        const form = new FormData()
        // Absent on the first request of a batch — that one mints the id.
        if (batchId !== null) form.append('batchId', batchId)
        for (const [index, photo] of chunk.entries()) {
          const binary = atob(photo.base64)
          const bytes = new Uint8Array(binary.length)
          for (let b = 0; b < binary.length; b++) bytes[b] = binary.charCodeAt(b)
          form.append('files', new File([bytes], `drop-${index}.jpg`, { type: 'image/jpeg' }))
          form.append('takenAt', photo.takenAt)
        }

        const res = await fetch('/api/import', { method: 'POST', body: form })
        const body = (await res.json()) as {
          batchId?: string
          photos?: { id: string }[]
          errors?: string[]
          error?: string
        }
        return { status: res.status, ...body }
      },
      { chunk, batchId },
    )

    chunks += 1

    if (result.status !== 200 || typeof result.batchId !== 'string') {
      throw new Error(`dropImportPhotos: POST /api/import answered ${result.status}: ${result.error ?? 'no batch id'}`)
    }
    // Per-file failures are the route's business to report and the seller's to
    // read; in a spec they mean the fixture is broken, so they stop the test
    // here rather than surfacing as a missing card three assertions later.
    if (result.errors && result.errors.length > 0) {
      throw new Error(`dropImportPhotos: the route refused a file: ${result.errors.join(' / ')}`)
    }

    batchId = result.batchId
    photoIds.push(...(result.photos ?? []).map((photo) => photo.id))
  }

  if (batchId === null) throw new Error('dropImportPhotos: nothing to drop')
  return { batchId, photoIds, chunks }
}

/**
 * Throws away everything one import left behind — rows and files — the way
 * `discardBatch` does, without importing it: that module carries 'use server'
 * and calls revalidatePath, which needs a Next request context this process
 * does not have.
 *
 * Photos go by batch id AND by item, because the two sets differ: a photo
 * carries its `importBatchId` for life (it is provenance, spec §7.3), while a
 * published item's photos are reachable only through the item.
 */
export async function cleanupImportBatch(batchId: string | undefined): Promise<void> {
  if (!batchId) return

  // Read before anything is deleted: Photo cascades with its item, so once the
  // items are gone nothing ties those files to this batch any more.
  const photos = await db.photo.findMany({
    where: { OR: [{ importBatchId: batchId }, { item: { importBatchId: batchId } }] },
    select: { id: true },
  })

  await db.item.deleteMany({ where: { importBatchId: batchId } })
  await db.photo.deleteMany({ where: { importBatchId: batchId } })

  await Promise.all(photos.map((photo) => deletePhotoFiles(photo.id)))
}

/**
 * A small, valid JPEG — what a phone photo is to the intake route: something
 * `sniffImageType` recognises and sharp can decode into three widths and a
 * lqip. A distinct colour per index so no two photos of a drop are the same
 * bytes.
 */
async function testJpeg(index: number): Promise<Buffer> {
  const background = { r: (index * 37) % 256, g: (index * 71) % 256, b: (index * 113) % 256 }
  return sharp({ create: { width: 120, height: 90, channels: 3, background } })
    .jpeg()
    .toBuffer()
}

/**
 * Mints a real admin session cookie the same way src/lib/auth.ts's
 * signSession does for a genuine login, and attaches it to `context` — a
 * legitimate way to skip the login form on specs that are not themselves
 * testing login (buyer.spec.ts's admin.spec.ts sibling `wrong password`
 * test exercises the real form; this is for specs that only need to already
 * be signed in).
 */
export async function addAdminSession(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: signSession(),
      url: BASE_URL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}
