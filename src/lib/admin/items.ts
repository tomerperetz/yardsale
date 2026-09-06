import { ItemStatus, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { parseShekelInput } from '@/lib/money'
import { hebrewSlug, randomSuffix } from '@/lib/slug'
import { deleteItemPhotos } from '@/lib/images'

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

export async function updateItem(id: string, input: ItemInput): Promise<ItemResult> {
  const v = validate(input)
  if ('error' in v) return { ok: false, error: v.error }

  return db.$transaction(async (tx) => {
    const item = await tx.item.update({
      where: { id },
      data: {
        name: v.name,
        description: input.description.trim(),
        priceAgorot: v.priceAgorot,
        categoryId: await categoryId(tx, v.categoryName),
        pickupFrom: v.from,
        pickupTo: v.to,
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
