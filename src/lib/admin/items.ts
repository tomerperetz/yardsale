import { ItemStatus, OrderStatus, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { parseShekelInput } from '@/lib/money'
import { hebrewSlug, randomSuffix } from '@/lib/slug'
import { deleteItemPhotos } from '@/lib/images'
import { DRAFT_NAME } from '@/lib/admin/draft'
import { SELLABLE_STATUSES, type SellableStatus } from '@/lib/admin/item-status'

export type ItemInput = {
  name: string
  description: string
  price: string
  categoryName: string
  pickupFrom: string
  pickupTo: string
  photoIds: string[]
  publish: boolean
}

export type ItemResult = { ok: true; id: string; slug: string } | { ok: false; error: string }

export type DeleteResult = { ok: true } | { ok: false; error: string }

export function normalizeCategoryName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

function parseDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(`${raw}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

type ValidateResult =
  | { error: string }
  | { name: string; categoryName: string; priceAgorot: number; from: Date; to: Date }

function validate(input: ItemInput): ValidateResult {
  const name = input.name.trim()
  if (name === '') return { error: 'צריך שם לפריט.' as const }

  const categoryName = normalizeCategoryName(input.categoryName)
  if (categoryName === '') return { error: 'צריך לבחור קטגוריה.' as const }

  const priceAgorot = parseShekelInput(input.price)
  if (priceAgorot === null) return { error: 'מחיר לא תקין.' as const }

  const from = parseDate(input.pickupFrom)
  const to = parseDate(input.pickupTo)
  if (!from || !to) return { error: 'חלון איסוף לא תקין.' as const }
  if (to.getTime() < from.getTime()) return { error: 'חלון האיסוף מסתיים לפני שהוא מתחיל.' as const }

  return { name, categoryName, priceAgorot, from, to }
}

async function categoryId(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const existing = await tx.category.findUnique({ where: { name } })
  if (existing) return existing.id
  const created = await tx.category.create({ data: { name, slug: hebrewSlug(name, randomSuffix()) } })
  return created.id
}

export async function createItem(input: ItemInput): Promise<ItemResult> {
  const v = validate(input)
  if ('error' in v) return { ok: false, error: v.error }

  return db.$transaction(async (tx) => {
    const item = await tx.item.create({
      data: {
        slug: hebrewSlug(v.name, randomSuffix()),
        name: v.name,
        description: input.description.trim(),
        priceAgorot: v.priceAgorot,
        categoryId: await categoryId(tx, v.categoryName),
        pickupFrom: v.from,
        pickupTo: v.to,
        status: input.publish ? ItemStatus.AVAILABLE : ItemStatus.DRAFT,
      },
    })

    if (input.photoIds.length > 0) {
      await tx.photo.updateMany({ where: { id: { in: input.photoIds } }, data: { itemId: item.id } })
    }

    return { ok: true as const, id: item.id, slug: item.slug }
  })
}

/**
 * Hands the "new item" form the row its photo uploads target.
 *
 * Creating one per mount meant every load of /admin/items left a "פריט חדש"
 * row behind — opening the orders tab and coming back was enough — and the
 * seller's list filled with items they never made. An untouched draft is
 * indistinguishable from a fresh one, so reuse it rather than add another.
 * "Untouched" is deliberately narrow: once a photo lands on a draft, or the
 * seller renames it, it is theirs and the next form gets its own row.
 */
export async function openDraft(input: ItemInput): Promise<ItemResult> {
  const reusable = await db.item.findFirst({
    where: { status: ItemStatus.DRAFT, name: DRAFT_NAME, photos: { none: {} } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, slug: true },
  })
  if (reusable) return { ok: true, id: reusable.id, slug: reusable.slug }
  return createItem(input)
}

export async function updateItem(id: string, input: ItemInput): Promise<ItemResult> {
  const v = validate(input)
  if ('error' in v) return { ok: false, error: v.error }

  return db.$transaction(async (tx) => {
    // The single-item form (ItemForm.tsx) creates the item as a DRAFT with a
    // placeholder name before the seller has typed anything real, so its
    // slug — assigned once, at creation — is worthless until the first real
    // save. Read the status BEFORE this update to decide: while an item has
    // never left DRAFT its slug is disposable, so regenerate it from the
    // real name on every save (this is also what makes the very save that
    // publishes a draft — this call, with input.publish true — land on a
    // proper Hebrew slug instead of the placeholder). Once an item has ever
    // left DRAFT, freeze its slug permanently: buyers share item URLs into
    // WhatsApp groups, and silently regenerating one on a later name edit
    // would break every link already shared, with no way for whoever shared
    // it to find out. This is deliberate, not an oversight — do not "fix"
    // it by regenerating unconditionally.
    const current = await tx.item.findUnique({ where: { id }, select: { status: true } })

    const item = await tx.item.update({
      where: { id },
      data: {
        name: v.name,
        description: input.description.trim(),
        priceAgorot: v.priceAgorot,
        categoryId: await categoryId(tx, v.categoryName),
        pickupFrom: v.from,
        pickupTo: v.to,
        ...(current?.status === ItemStatus.DRAFT ? { slug: hebrewSlug(v.name, randomSuffix()) } : {}),
        ...(input.publish ? { status: ItemStatus.AVAILABLE } : {}),
      },
    })
    return { ok: true as const, id: item.id, slug: item.slug }
  })
}

/**
 * Refuses to delete an item that is RESERVED or SOLD, or that appears on any
 * order (even one that later reverted the item to AVAILABLE) — deleting one
 * would orphan an OrderItem row and corrupt a buyer's order history.
 *
 * The filesystem removal happens only after the database transaction has
 * committed, so a failed transaction never leaves the row pointing at
 * already-deleted files.
 */
// Every seller-settable status is a real ItemStatus. The client-side edit
// screen imports the list from the import-free module; this is what stops the
// two definitions drifting apart without anyone noticing.
const SELLABLE: readonly ItemStatus[] = SELLABLE_STATUSES

/** An order that still has a claim on its items. Cancelled and expired ones do not. */
const LIVE_ORDER_STATUSES = [OrderStatus.PENDING_PAYMENT, OrderStatus.CLAIMED_PAID, OrderStatus.PAID]

/**
 * Marks a published item sold by hand, or puts it back on sale.
 *
 * Two things it refuses, both for the same reason: an item a live order is
 * counting on must not move underneath that order. A `RESERVED` item is mid
 * hold, and an item on a `PAID` order was sold through the shop — flipping
 * either by hand would leave the order describing something that is no longer
 * true. Cancelled and expired orders have released their claim, so an item
 * that only appears on those is the seller's to move again.
 *
 * The write re-asserts the status it read, so a hold or a confirmation landing
 * between the check and the write loses nothing: the update matches no row and
 * the seller is told to look again, rather than silently overwriting it.
 */
export async function setItemStatus(id: string, status: SellableStatus): Promise<ItemResult> {
  if (!SELLABLE.includes(status)) return { ok: false, error: 'סטטוס לא חוקי.' }

  return db.$transaction(async (tx) => {
    const item = await tx.item.findUnique({
      where: { id },
      select: {
        slug: true,
        status: true,
        orderItems: {
          where: { order: { status: { in: LIVE_ORDER_STATUSES } } },
          select: { id: true },
          take: 1,
        },
      },
    })
    if (!item) return { ok: false as const, error: 'הפריט לא נמצא.' }
    if (item.status === status) return { ok: true as const, id, slug: item.slug }

    if (item.status === ItemStatus.DRAFT) {
      return { ok: false as const, error: 'הפריט עדיין טיוטה. פרסמו אותו קודם.' }
    }
    if (item.status === ItemStatus.RESERVED) {
      return { ok: false as const, error: 'הפריט שמור להזמנה פעילה. בטלו את ההזמנה כדי לשחרר אותו.' }
    }
    if (item.orderItems.length > 0) {
      return { ok: false as const, error: 'הפריט נמכר דרך האתר ושייך להזמנה. אי אפשר לשנות את הסטטוס שלו.' }
    }

    const moved = await tx.item.updateMany({ where: { id, status: item.status }, data: { status } })
    if (moved.count === 0) {
      return { ok: false as const, error: 'הסטטוס של הפריט השתנה בינתיים. רעננו את הדף ונסו שוב.' }
    }

    return { ok: true as const, id, slug: item.slug }
  })
}

export async function deleteItem(id: string): Promise<DeleteResult> {
  const result = await db.$transaction(async (tx) => {
    const item = await tx.item.findUnique({
      where: { id },
      select: { status: true, orderItems: { select: { id: true }, take: 1 } },
    })
    if (!item) return { ok: false as const, error: 'הפריט לא נמצא.' }

    if (item.status === ItemStatus.RESERVED || item.status === ItemStatus.SOLD || item.orderItems.length > 0) {
      return { ok: false as const, error: 'אי אפשר למחוק פריט ששייך להזמנה.' }
    }

    await tx.photo.deleteMany({ where: { itemId: id } })
    await tx.item.delete({ where: { id } })
    return { ok: true as const }
  })

  if (result.ok) await deleteItemPhotos(id)
  return result
}
