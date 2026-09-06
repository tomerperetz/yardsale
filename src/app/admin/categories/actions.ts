'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { mergeCategories, renameCategory, type suggestMerges } from '@/lib/admin/categories'

/**
 * `mergeCategories` is destructive: it reassigns every item off `fromId`
 * and deletes it. The UI (`MergeBanner`) requires an explicit inline
 * confirmation step before ever calling this — never a bare click.
 */
export async function mergeCategoriesAction(
  fromId: string,
  intoId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await mergeCategories(fromId, intoId)
  if (!result.ok) return result
  revalidatePath('/admin/categories')
  revalidatePath('/admin/items')
  return { ok: true }
}

export async function renameCategoryAction(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const result = await renameCategory(id, name)
  if (result.ok) revalidatePath('/admin/categories')
  return result
}

/** Same pair-key format `suggestMerges` checks against — sorted ids joined by ':'. */
function pairKey(pair: ReturnType<typeof suggestMerges>[number]): string {
  return [pair.aId, pair.bId].sort().join(':')
}

export async function dismissMergeAction(aId: string, bId: string): Promise<{ ok: true }> {
  const key = pairKey({ aId, bId })
  const settings = await getSettings()
  if (!settings.dismissedMerges.includes(key)) {
    await db.settings.update({ where: { id: 1 }, data: { dismissedMerges: { push: key } } })
  }
  revalidatePath('/admin/categories')
  return { ok: true }
}
