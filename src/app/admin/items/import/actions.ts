'use server'

import { revalidatePath } from 'next/cache'
import { clusterBatch, type ClusterBatchResult } from '@/lib/import/batch'

/**
 * The import flow's server actions. As with src/app/admin/items/actions.ts,
 * these are thin wrappers: the logic lives in plain modules that a test can
 * call directly, and this file exists only because a client component can
 * invoke nothing that does not carry the 'use server' directive.
 *
 * Authentication is src/middleware.ts's, whose matcher covers /admin/:path* —
 * a server action posts to the route it was rendered from, and every screen
 * that can reach these is under /admin.
 */

/**
 * Groups a finished upload batch into DRAFT items and writes their copy.
 * See `clusterBatch` (spec §7.2): it degrades rather than failing, so the
 * seller reaches the review screen with every photo on an item even when the
 * model call does not happen at all.
 */
export async function clusterBatchAction(batchId: string): Promise<ClusterBatchResult> {
  const result = await clusterBatch(batchId)
  // The drafts show up in the seller's item list straight away, review screen
  // or not — spec §3.4 is that closing the tab loses nothing.
  if (result.ok) revalidatePath('/admin/items')
  return result
}
