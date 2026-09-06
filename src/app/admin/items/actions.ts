'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { deletePhotoFiles } from '@/lib/images'
import {
  createItem,
  updateItem,
  deleteItem as deleteItemRecord,
  type ItemInput,
  type ItemResult,
  type DeleteResult,
} from '@/lib/admin/items'

/**
 * Thin 'use server' wrappers around src/lib/admin/items.ts — client
 * components (ItemForm, BulkQueue, PhotoDrop) can only invoke functions from
 * a file carrying the 'use server' directive, so the validated logic itself
 * stays in the plain, directly-testable lib module and this file just
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

export async function deleteItemAction(id: string): Promise<DeleteResult> {
  const result = await deleteItemRecord(id)
  if (result.ok) revalidatePath('/admin/items')
  return result
}

/** Removes one photo — its row and every width variant on disk. */
export async function removePhotoAction(itemId: string, photoId: string): Promise<{ ok: true }> {
  await db.photo.delete({ where: { id: photoId } }).catch(() => null)
  await deletePhotoFiles(itemId, photoId)
  return { ok: true }
}

/** Persists a new drag-to-reorder position for every photo of one item. */
export async function reorderPhotosAction(orderedIds: string[]): Promise<{ ok: true }> {
  await db.$transaction(orderedIds.map((id, position) => db.photo.update({ where: { id }, data: { position } })))
  return { ok: true }
}
