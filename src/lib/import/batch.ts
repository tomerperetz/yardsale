import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ItemStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { hebrewSlug, randomSuffix } from '@/lib/slug'
import { aiEnabled, captionItem, clusterPhotos } from '@/lib/ai/client'
import type { AiFailure, AiResult, Caption } from '@/lib/ai/types'
import { DRAFT_NAME } from '@/lib/admin/draft'
import { startOfUtcDay } from '@/lib/dates'
import { groupByCaptureTime, type PhotoStamp } from '@/lib/exif'
import { photoDir, photoFilename } from '@/lib/images'

/**
 * Turning an uploaded batch into draft items — spec §7.2.
 *
 * The photos are already on disk with an `importBatchId` and no item
 * (POST /api/import). This groups them, creates one DRAFT item per group with
 * every photo attached, and then writes the Hebrew copy. Both model calls go
 * through src/lib/ai/client.ts, which never throws: every failure here
 * degrades to something the seller can still work with, because the photos
 * are already uploaded and losing them is the one outcome that is not allowed.
 */

/** What the review screen tells the seller about the copy it was given. */
export type ImportNotice = 'NONE' | 'NO_COPY' | 'OUT_OF_CREDIT'

export type ClusterBatchResult =
  | { ok: true; itemIds: string[]; notice: ImportNotice }
  | { ok: false; error: string }

/** The width both passes show the model — the smallest stored, and plenty to recognise an object by. */
const MODEL_WIDTH = 400

/** Matches the /admin/items default: today, through six days from today. */
const DEFAULT_WINDOW_DAYS = 6
const DAY_MS = 86_400_000

/**
 * The category a shop with no categories at all falls back to: an item needs
 * one, and a brand new shop has none, so importing before a single category
 * has ever been typed must still work. Now the only definition of it — the
 * single-item form carried a copy of this string until that form was removed.
 */
const FALLBACK_CATEGORY = 'כללי'

type BatchPhoto = { id: string; takenAt: Date | null }
export type CategoryRef = { id: string; name: string }
export type Defaults = { categoryId: string; pickupFrom: Date; pickupTo: Date; categories: CategoryRef[] }
type NewItem = { id: string; photoIds: string[] }

/** A grouping, plus whether the copy pass is allowed to run over it at all. */
type Clustering = { groups: string[][]; captionable: boolean; notice: ImportNotice }

export async function clusterBatch(batchId: string): Promise<ClusterBatchResult> {
  // `itemId: null` explicitly, not the batch id alone: importBatchId is
  // provenance and is never cleared, so a batch that has already been
  // clustered still names all of its photos (spec §7.3).
  const photos = await db.photo.findMany({
    where: { importBatchId: batchId, itemId: null },
    orderBy: { position: 'asc' },
    select: { id: true, takenAt: true },
  })
  if (photos.length === 0) return { ok: false, error: 'לא נמצאו תמונות לייבוא.' }

  const enabled = aiEnabled()
  // Read once and reused by the caption pass — and not read at all when the
  // feature is off, which would be up to sixty files decoded for nobody.
  const bytes = enabled ? await readPhotoBytes(photos.map((p) => p.id)) : new Map<string, Buffer>()

  const clustering = enabled ? await cluster(photos, bytes) : degraded(photos, 'NO_COPY')

  // The defaults are read before anything is created, so the items this call
  // makes cannot become their own "most recent item".
  const defaults = await carriedForward()

  let created: NewItem[]
  try {
    created = await createItems(batchId, accountForEveryPhoto(clustering.groups, photos), defaults)
  } catch (err) {
    console.error('[import] creating the items for batch', batchId, 'failed:', err)
    return { ok: false, error: 'שגיאה ביצירת הפריטים. נסו שוב.' }
  }

  const itemIds = created.map((item) => item.id)

  // The latch, and the reason it is a return rather than a guard inside the
  // caption pass: once clustering has failed there is no per-item decision
  // left to make, and the pass must not be entered even once. Spec §7.4,
  // "Running out of credit": sixty doomed calls in a row against a dead key is
  // the wrong way to discover it. Everything below this line is that pass.
  if (!clustering.captionable) return { ok: true, itemIds, notice: clustering.notice }

  return { ok: true, itemIds, notice: await captionItems(created, bytes, defaults.categories) }
}

/**
 * Pass 1. Falls back to capture-time grouping on every failure, so the seller
 * always reaches the review screen with every photo accounted for (spec §7.4).
 *
 * `captionable` is false on every one of those paths. A model that could not
 * group the batch is not a model that is going to write copy for it, and the
 * OUT_OF_CREDIT case must make no further calls for this batch at all.
 */
async function cluster(photos: BatchPhoto[], bytes: Map<string, Buffer>): Promise<Clustering> {
  const images = photos.filter((p) => bytes.has(p.id)).map((p) => ({ id: p.id, webp: bytes.get(p.id)! }))

  // Nothing readable to show it — a misconfigured UPLOAD_DIR, or a volume that
  // did not come back. This costs no API call either way: clusterPhotos
  // short-circuits an empty list, and so does captionItem. What it changes is
  // which of the two placeholder semantics this batch gets. Without it the
  // empty grouping reads as a success, the caption pass runs, and every item
  // is emptied to `name: ''` — the "asked and had nothing" outcome — when in
  // truth the model was never asked. Recognised as a degradation, the items
  // keep their placeholder and the seller is told no copy was generated.
  if (images.length === 0) return degraded(photos, 'NO_COPY')

  // The one seam whose throw would cost the seller the whole batch: an
  // unhandled rejection here rejects clusterBatch, so no item is created and
  // every photo stays itemId: null — invisible to the review screen, and
  // reachable only by the batch-wide discard. A throw is a failed call like
  // any other, so it takes the same capture-time fallback.
  const clustered = await clusterPhotos(images).catch((err): AiResult<string[][]> => {
    console.error('[import] the clustering call threw:', err)
    return { ok: false, reason: 'FAILED' }
  })

  if (clustered.ok) return { groups: clustered.value, captionable: true, notice: 'NONE' }

  return degraded(photos, clustered.reason === 'OUT_OF_CREDIT' ? 'OUT_OF_CREDIT' : 'NO_COPY')
}

/**
 * Today's fallback grouping, and no copy: what every failed or skipped
 * clustering lands on.
 *
 * Items from here keep the `DRAFT_NAME` placeholder they were created with,
 * where an item whose own caption call failed is emptied (see `captionOne`).
 * That is deliberate and is the difference between "never asked" and "asked
 * and had nothing": pass 2 never ran for these, so §7.2 step 4's placeholder
 * is still the truth about them.
 */
function degraded(photos: BatchPhoto[], notice: ImportNotice): Clustering {
  const stamps: PhotoStamp[] = photos.map((p) => ({ key: p.id, takenAt: p.takenAt, lastModified: null }))
  return { groups: groupByCaptureTime(stamps), captionable: false, notice }
}

/**
 * Every photo of the batch in exactly one group, whichever pass produced them.
 *
 * `normalizeClusters` already guarantees this for a model response and
 * `groupByCaptureTime` gives an untimed photo its own group — but a photo left
 * with a null `itemId` is unreachable from the review screen and invisible to
 * the item-keyed discard, so the guarantee is asserted here over both paths
 * rather than assumed from either. Ids not in the batch and ids repeated
 * across groups are dropped; anything left unplaced becomes its own item,
 * which is what spec §7.4's last row asks for.
 */
function accountForEveryPhoto(groups: string[][], photos: BatchPhoto[]): string[][] {
  const inBatch = new Set(photos.map((p) => p.id))
  const placed = new Set<string>()
  const out: string[][] = []

  for (const group of groups) {
    const kept: string[] = []
    for (const id of group) {
      // Marked placed as it is kept, not after the group is done, so that an
      // id repeated *inside* one group is caught as well as one repeated
      // across two — the same photo written twice would leave its item's
      // positions numbered from one rather than zero.
      if (!inBatch.has(id) || placed.has(id)) continue
      placed.add(id)
      kept.push(id)
    }
    if (kept.length > 0) out.push(kept)
  }

  for (const photo of photos) {
    if (!placed.has(photo.id)) out.push([photo.id])
  }

  return out
}

/**
 * One DRAFT item per group with its photos attached, in one transaction: a
 * half-clustered batch — some items made, some photos still loose — is the one
 * state no screen can show and no discard can reach.
 *
 * The name is a placeholder (spec §7.2 step 4) and so is the slug derived from
 * it; a draft regenerates its slug on every save, so the first real headline
 * the seller keeps is the one the URL ends up with.
 */
async function createItems(batchId: string, groups: string[][], defaults: Defaults): Promise<NewItem[]> {
  return db.$transaction(
    async (tx) => {
      const created: NewItem[] = []
      for (const photoIds of groups) {
        const item = await tx.item.create({
          data: {
            slug: hebrewSlug(DRAFT_NAME, randomSuffix()),
            name: DRAFT_NAME,
            description: '',
            priceAgorot: 0,
            categoryId: defaults.categoryId,
            pickupFrom: defaults.pickupFrom,
            pickupTo: defaults.pickupTo,
            status: ItemStatus.DRAFT,
            importBatchId: batchId,
          },
        })
        for (const [position, photoId] of photoIds.entries()) {
          await tx.photo.update({ where: { id: photoId }, data: { itemId: item.id, position } })
        }
        created.push({ id: item.id, photoIds })
      }
      return created
    },
    // A sixty-photo batch is sixty updates plus its items, and the default 5s
    // is a tight budget for that on a database that is not on this machine.
    { timeout: 30_000 },
  )
}

/**
 * Pass 2, one call per item and all of them in flight together. Each item's
 * outcome is its own: a call that fails, or a database write that does, costs
 * that item its copy and nothing else (spec §7.4).
 */
async function captionItems(items: NewItem[], bytes: Map<string, Buffer>, categories: CategoryRef[]): Promise<ImportNotice> {
  const names = categories.map((c) => c.name)
  const idByName = new Map(categories.map((c) => [c.name, c.id]))

  const failures = await Promise.all(
    items.map(async (item) => {
      try {
        return await captionOne(item, bytes, names, idByName)
      } catch (err) {
        // captionOne defends the model call itself, so what is left here is
        // the database write — nothing another write could repair. Still this
        // item's problem alone, never the batch's.
        console.error('[import] captioning item', item.id, 'failed:', err)
        return 'FAILED' as const
      }
    }),
  )

  if (failures.includes('OUT_OF_CREDIT')) return 'OUT_OF_CREDIT'
  if (failures.some((failure) => failure !== null)) return 'NO_COPY'
  return 'NONE'
}

/** The failure reason, or null when the item got its copy. */
async function captionOne(
  item: NewItem,
  bytes: Map<string, Buffer>,
  names: string[],
  idByName: Map<string, string>,
): Promise<AiFailure | null> {
  const images = item.photoIds.map((id) => bytes.get(id)).filter((webp): webp is Buffer => webp !== undefined)

  // captionItem's contract is that it does not throw, and every failure it
  // reports lands on the same handling below. Held to that here rather than
  // trusted, so that a bug on the other side of the seam costs this item its
  // copy — the documented outcome — instead of leaving it holding a
  // placeholder name that reads like copy the model actually wrote.
  const caption = await captionItem(images, names).catch((err): AiResult<Caption> => {
    console.error('[import] the caption call for item', item.id, 'threw:', err)
    return { ok: false, reason: 'FAILED' }
  })

  if (!caption.ok) {
    // Spec §7.4: an item whose caption failed gets an empty name and
    // description. The placeholder is cleared deliberately — the model was
    // asked and had nothing, and an item cannot be published without a name,
    // so the seller is sent to the one field they must fill in themselves.
    await db.item.update({ where: { id: item.id }, data: { name: '', description: '' } })
    return caption.reason
  }

  // One of the seller's own names, a new one the model proposed, or '' when it
  // could not tell (spec §3.5). An empty one leaves the carried-forward
  // default in place; a proposal is created now so the item has a real
  // category, and the review screen flags it as new before the seller accepts.
  const categoryId = caption.value.category === ''
    ? undefined
    : (idByName.get(caption.value.category) ?? (await createProposedCategory(caption.value.category)))

  await db.item.update({
    where: { id: item.id },
    data: {
      name: caption.value.headline,
      description: caption.value.description,
      ...(categoryId ? { categoryId } : {}),
    },
  })
  return null
}

/**
 * Creates a category the model proposed, or returns the existing one if
 * another caption in the same batch proposed it first.
 *
 * Captions run in parallel, so two items can propose the same new name at the
 * same moment. `name` is unique, so the loser gets P2002 — which is not a
 * failure here, it is the answer: the category now exists and both items want
 * it. Anything else is left to the caller's own failure handling rather than
 * silently swallowed.
 */
async function createProposedCategory(name: string): Promise<string | undefined> {
  try {
    const created = await db.category.create({
      data: { name, slug: hebrewSlug(name, randomSuffix()) },
      select: { id: true },
    })
    return created.id
  } catch {
    const existing = await db.category.findUnique({ where: { name }, select: { id: true } })
    return existing?.id
  }
}

/**
 * The defaults an imported item opens with — the same ones /admin/items
 * computes for the entry form, so a seller who imports gets what a seller who
 * types would have got: the category and pickup window of their most recent
 * item.
 *
 * Exported for `movePhoto(photoId, 'new')` on the review screen, which mints a
 * draft mid-review and must open it with the same defaults the batch's other
 * items opened with rather than a second, drifting copy of this rule.
 */
export async function carriedForward(): Promise<Defaults> {
  const [last, categories] = await Promise.all([
    db.item.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { categoryId: true, pickupFrom: true, pickupTo: true },
    }),
    db.category.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])

  const today = startOfUtcDay(new Date())
  const pickupFrom = last?.pickupFrom ?? today
  const pickupTo = last?.pickupTo ?? new Date(today.getTime() + DEFAULT_WINDOW_DAYS * DAY_MS)

  if (last) return { categoryId: last.categoryId, pickupFrom, pickupTo, categories }
  if (categories.length > 0) return { categoryId: categories[0].id, pickupFrom, pickupTo, categories }

  const created = await db.category.create({
    data: { name: FALLBACK_CATEGORY, slug: hebrewSlug(FALLBACK_CATEGORY, randomSuffix()) },
  })
  return { categoryId: created.id, pickupFrom, pickupTo, categories: [{ id: created.id, name: created.name }] }
}

/**
 * The bytes both passes show the model, by photo id. A photo whose file cannot
 * be read is simply absent: it is not shown to the model, and
 * `accountForEveryPhoto` still gives it an item, because a missing file is no
 * reason for a row to end up on nothing.
 */
async function readPhotoBytes(ids: string[]): Promise<Map<string, Buffer>> {
  const bytes = new Map<string, Buffer>()
  const unreadable: string[] = []

  await Promise.all(
    ids.map(async (id) => {
      try {
        bytes.set(id, await readFile(path.join(photoDir(id), photoFilename(MODEL_WIDTH))))
      } catch (err) {
        unreadable.push(`${id} (${err instanceof Error ? err.message : String(err)})`)
      }
    }),
  )

  // One line for the batch rather than one per photo: a misconfigured
  // UPLOAD_DIR makes every photo unreadable at once, and sixty stack traces
  // would bury the rest of the import's logging.
  if (unreadable.length > 0) {
    console.error(`[import] no readable ${MODEL_WIDTH}px file for ${unreadable.length} photo(s):`, unreadable.join('; '))
  }

  return bytes
}
