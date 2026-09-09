import { ItemStatus, OrderStatus, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { parseShekelInput } from '@/lib/money'
import { hebrewSlug, randomSuffix } from '@/lib/slug'
import { deletePhotoFiles } from '@/lib/images'
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

/**
 * An `<input type="date">` value as the UTC-midnight Date the schema stores.
 *
 * Exported so the import screen's bulk edit validates a pickup window by the
 * same rule as every other caller, rather than growing a second parser that
 * accepts a shape this one rejects.
 */
export function parseDate(raw: string): Date | null {
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

/**
 * The id of a category by name, creating it the first time it is used.
 *
 * Exported for the import screen's bulk edit, which sets one category across a
 * selection and must mint a new one exactly as the item form does — same
 * normalized name, same generated slug.
 */
export async function categoryId(tx: Prisma.TransactionClient, name: string): Promise<string> {
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

    // `itemId: null` is the whole point of the filter: it claims only photos
    // that are not already on a product. Without it this is a steal — hand it
    // an id belonging to another item and that item silently loses the photo,
    // with no error and nothing in the seller's list explaining where it went.
    // Harmless while a photo could only ever be attached once, on the way in
    // from /api/upload; not harmless now that the import screen moves photos
    // between items and an id can arrive here already spoken for.
    if (input.photoIds.length > 0) {
      await tx.photo.updateMany({
        where: { id: { in: input.photoIds }, itemId: null },
        data: { itemId: item.id },
      })
    }

    return { ok: true as const, id: item.id, slug: item.slug }
  })
}

export async function updateItem(id: string, input: ItemInput): Promise<ItemResult> {
  const v = validate(input)
  if ('error' in v) return { ok: false, error: v.error }

  return db.$transaction(async (tx) => {
    // The import creates its items as DRAFTs named DRAFT_NAME before the
    // seller (or the model) has supplied anything real — `clusterBatch` and
    // `movePhoto(_, 'new')` both do — so their slugs, assigned once at
    // creation, are worthless until the first real save. The bulk queue is
    // the same story with a real name but no photos yet. Read the status
    // BEFORE this update to decide: while an item has never left DRAFT its
    // slug is disposable, so regenerate it from the real name on every save
    // (this is also what makes the very save that publishes a draft — this
    // call, with input.publish true — land on a proper Hebrew slug instead
    // of the placeholder). Once an item has ever left DRAFT, freeze its slug
    // permanently: buyers share item URLs into WhatsApp groups, and silently
    // regenerating one on a later name edit would break every link already
    // shared, with no way for whoever shared it to find out. This is
    // deliberate, not an oversight — do not "fix" it by regenerating
    // unconditionally.
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

// Every seller-settable status is a real ItemStatus. The client-side edit
// screen imports the list from the import-free module; this is what stops the
// two definitions drifting apart without anyone noticing.
const SELLABLE: readonly ItemStatus[] = SELLABLE_STATUSES

/**
 * An order that still has a claim on its items. Cancelled and expired ones do
 * not. Exported because the import screen's `publishItems` has to ask the same
 * question of the same orders — a second list that fell behind this one would
 * let a bulk publish move an item underneath a live order.
 */
export const LIVE_ORDER_STATUSES = [OrderStatus.PENDING_PAYMENT, OrderStatus.CLAIMED_PAID, OrderStatus.PAID]

/**
 * The two refusals an item under an order's claim gets, wherever it is asked to
 * move. Shared with `publishItems`, which enforces the same rule from the
 * import screen: as constants rather than as two copies of the text, so that
 * rewording one cannot leave the other saying something else.
 */
export const HELD_BY_ORDER = 'הפריט שמור להזמנה פעילה. בטלו את ההזמנה כדי לשחרר אותו.'
// Both point at the same way out, because there is one: the order. This one
// used to end "אי אפשר לשנות את הסטטוס שלו" — true only while a PAID order was
// terminal. It no longer is (src/lib/orders/state.ts), and this is the exact
// screen a seller who confirmed a payment by mistake looks at first.
export const SOLD_THROUGH_SHOP = 'הפריט נמכר דרך האתר ושייך להזמנה. בטלו את ההזמנה כדי לשחרר אותו.'

/**
 * Moves a published item between the three states its seller controls: on the
 * shop, sold by hand to someone who turned up, or hidden — off the shop but
 * still in the seller's list, keeping its slug so unhiding restores the link
 * buyers already have.
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
      return { ok: false as const, error: HELD_BY_ORDER }
    }
    if (item.orderItems.length > 0) {
      return { ok: false as const, error: SOLD_THROUGH_SHOP }
    }

    const moved = await tx.item.updateMany({ where: { id, status: item.status }, data: { status } })
    if (moved.count === 0) {
      return { ok: false as const, error: 'הסטטוס של הפריט השתנה בינתיים. רעננו את הדף ונסו שוב.' }
    }

    return { ok: true as const, id, slug: item.slug }
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

    // Read the ids before the rows go: files are keyed by photo, so once
    // these rows are deleted nothing on disk or in the database still ties a
    // file to this item. Looking them up after the transaction would find
    // none and leave every width of every photo behind forever.
    const photos = await tx.photo.findMany({ where: { itemId: id }, select: { id: true } })

    await tx.photo.deleteMany({ where: { itemId: id } })
    await tx.item.delete({ where: { id } })
    return { ok: true as const, photoIds: photos.map((p) => p.id) }
  })

  if (!result.ok) return result

  // Only once the rows are committed gone, so a crash between the two never
  // leaves a Photo row pointing at a file that isn't there. deletePhotoFiles
  // never throws, so a cleanup failure cannot turn a successful delete into
  // an error the seller sees.
  await Promise.all(result.photoIds.map((photoId) => deletePhotoFiles(photoId)))
  return { ok: true }
}
