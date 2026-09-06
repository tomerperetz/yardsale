import 'dotenv/config'
import type { BrowserContext } from '@playwright/test'
import { ItemStatus, OrderStatus, PickupSlot, type Settings } from '@prisma/client'
import { db } from '../src/lib/db'
import { seed } from '../prisma/seed'
import { reserveItems, type ReserveResult } from '../src/lib/orders/reserve'
import { newOrderCode, newOrderToken } from '../src/lib/orders/codes'
import { utcDate } from '../src/lib/dates'
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
 * Resets the Settings singleton (id=1) to a known "open for business"
 * baseline, then applies overrides — the same pattern tests/db/reserve.test.ts
 * already uses (`openShop()`), since Settings has exactly one row shared by
 * the whole database.
 *
 * Deliberately does NOT touch Category/Item/Order/Photo rows and never calls
 * resetDb(): this Postgres instance is shared with other work on this
 * machine, so this suite only ever deletes what it itself created — see
 * cleanupItems/cleanupOrders below.
 */
export async function seedShop(overrides: SettingsOverrides = {}): Promise<void> {
  await seed()
  await db.settings.update({
    where: { id: 1 },
    data: {
      shopName: 'חצר של דנה',
      tagline: 'הכל חייב לצאת עד יום ראשון',
      bitPhone: '0501234567',
      addressLine: 'הרצל 12',
      city: 'תל אביב',
      slotMorning: '',
      slotAfternoon: '',
      slotEvening: '',
      holdMinutes: 15,
      dismissedMerges: [],
      ...overrides,
    },
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
