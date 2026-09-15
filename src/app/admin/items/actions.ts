'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { deletePhotoFiles } from '@/lib/images'
import {
  createItem,
  setItemStatus,
  setPickupWindowForAll,
  updateItem,
  deleteItem as deleteItemRecord,
  type ItemInput,
  type ItemResult,
  type DeleteResult,
  type PickupWindowResult,
} from '@/lib/admin/items'
import type { SellableStatus } from '@/lib/admin/item-status'
import { rewriteDescriptions, type RewriteResult } from '@/lib/import/rewrite'

/**
 * Thin 'use server' wrappers around src/lib/admin/items.ts — client
 * components (BulkQueue, EditItemForm, PhotoDrop) can only invoke functions
 * from a file carrying the 'use server' directive, so the validated logic
 * itself stays in the plain, directly-testable lib module and this file just
 * exposes it plus the photo-management bits that logic doesn't need to know
 * about.
 */

export async function createItemAction(input: ItemInput): Promise<ItemResult> {
  return createItem(input)
}

export async function updateItemAction(id: string, input: ItemInput): Promise<ItemResult> {
  const result = await updateItem(id, input)
  if (result.ok) revalidatePath('/admin/items')
  return result
}

/** Take an item off sale, put it back, or mark it sold in person — see `setItemStatus`. */
export async function setItemStatusAction(id: string, status: SellableStatus): Promise<ItemResult> {
  const result = await setItemStatus(id, status)
  if (result.ok) {
    revalidatePath('/admin/items')
    revalidatePath('/')
  }
  return result
}

/**
 * One pickup window across the whole shop — see `setPickupWindowForAll`, which
 * refuses to move an item a live order is holding.
 *
 * Revalidates the shop as well as the seller's list: a window the buyer reads
 * on every card and on the item page has just changed for every item on it.
 */
export async function setPickupWindowAction(from: string, to: string): Promise<PickupWindowResult> {
  const result = await setPickupWindowForAll(from, to)
  if (result.ok && result.updated > 0) {
    revalidatePath('/admin/items')
    revalidatePath('/')
  }
  return result
}

/**
 * Rewrites every eligible item's description from its own photographs — the
 * repair for listings written before the copy pass existed, and for the ones
 * whose description is the name of their own category.
 *
 * Descriptions only. See `rewriteDescriptions`: the name, category and price
 * are the seller's, and buyers have already seen them.
 *
 * Revalidates the shop as well as the seller's list, because the description
 * is on the item page a buyer reads before deciding.
 */
export async function rewriteDescriptionsAction(): Promise<RewriteResult> {
  const result = await rewriteDescriptions()
  if (result.ok && result.rewritten > 0) {
    revalidatePath('/admin/items')
    revalidatePath('/')
  }
  return result
}

export async function deleteItemAction(id: string): Promise<DeleteResult> {
  const result = await deleteItemRecord(id)
  if (result.ok) revalidatePath('/admin/items')
  return result
}

/** Removes one photo — its row and every width variant on disk. */
export async function removePhotoAction(photoId: string): Promise<{ ok: true }> {
  await db.photo.delete({ where: { id: photoId } }).catch(() => null)
  await deletePhotoFiles(photoId)
  return { ok: true }
}

/** Persists a new drag-to-reorder position for every photo of one item. */
export async function reorderPhotosAction(orderedIds: string[]): Promise<{ ok: true }> {
  await db.$transaction(orderedIds.map((id, position) => db.photo.update({ where: { id }, data: { position } })))
  return { ok: true }
}
