/**
 * How a photo is addressed, and how large one is allowed to be. Deliberately
 * free of `sharp` — src/lib/images.ts does the image work and imports from
 * here, and client components (PhotoDrop, BulkQueue, ItemCard, ItemDetail)
 * import from here too, which they cannot do from images.ts without pulling a
 * native module into the browser bundle.
 *
 * The upload limits used to be hand-mirrored in each client component with a
 * comment apologising for it. They live here now, in one place, so the
 * seller's instant feedback and the server's enforcement cannot drift apart.
 */

/** Every uploaded photo is stored at each of these widths. */
export const WIDTHS = [400, 800, 1600] as const
export type PhotoWidth = (typeof WIDTHS)[number]

/** Per file. Phone photos run 2-5 MB, so this is generous on purpose. */
export const MAX_BYTES = 12 * 1024 * 1024

export const MAX_PHOTOS_PER_ITEM = 10

/**
 * Per POST /api/upload request. One itemId, a 10-photo-per-item cap and 2-5 MB
 * phone photos, so 64 MB comfortably covers a full batch with headroom.
 */
export const MAX_REQUEST_BYTES = 64 * 1024 * 1024

/**
 * The most photos one import batch may hold, across every request that adds to
 * it, and the ONLY bound on a batch. MAX_PHOTOS_PER_ITEM does not apply to an
 * import: the seller drops a whole sale at once and clustering decides
 * afterwards which photos are one product, so a cluster has no cap — twelve
 * shots of one sofa must all survive.
 */
export const MAX_IMPORT_FILES = 60

/**
 * How many photos the client puts in one POST /api/import (spec §7.1).
 *
 * A sixty-photo drop is not one request: request.formData() buffers the whole
 * multipart body before any per-file check can run, so one request carrying
 * the batch would mean a quarter of a gigabyte resident at once — plus sharp's
 * working memory per photo — on a container whose memory limit is not ours to
 * assume, and many platforms cap request bodies well below that anyway. An OOM
 * there costs the seller the entire drop.
 *
 * At six, memory is bounded regardless of how much the seller drops, the
 * photos land visibly as they go, and a dropped connection costs one chunk
 * rather than everything. The server does not enforce this count — the byte
 * ceiling below and MAX_IMPORT_FILES are the bounds it enforces — it is here so
 * the client and that ceiling are sized from one number.
 */
export const IMPORT_CHUNK_FILES = 6

/**
 * Per POST /api/import request: one chunk of the largest files this route
 * accepts, plus a megabyte for multipart framing so that six individually
 * legal files are never refused as the sum of their parts.
 *
 * Not MAX_REQUEST_BYTES, whose 64 MB is sized for one item's ten photos and
 * would be both too small for a chunk of six 12 MB files and, more to the
 * point, about a different route's cap.
 */
export const MAX_IMPORT_REQUEST_BYTES = IMPORT_CHUNK_FILES * MAX_BYTES + 1024 * 1024

/**
 * What a photo id is allowed to look like, and the only thing that may become
 * a directory name under UPLOAD_DIR.
 *
 * Every id the server mints already satisfies it — cuid and the upload route's
 * hex are both lowercase alphanumeric — so this exists for the ids it must
 * reject: '' and '..' both survive `path.join`, turning a photo directory into
 * the upload volume or its parent. Both the serving route and the delete path
 * check it, from here, so the two cannot drift.
 */
export const PHOTO_ID_RE = /^[a-z0-9]+$/

/** The file one width of one photo is stored as, on disk and in the URL. */
export function photoFilename(width: PhotoWidth): string {
  return `${width}.webp`
}

/**
 * Where the browser fetches one width of one photo.
 *
 * Deliberately free of any item id: a photo may not belong to an item yet
 * (an import batch), and moving one between items must not move files.
 * See src/app/img/[photoId]/[file]/route.ts.
 */
export function photoUrl(photoId: string, width: PhotoWidth = 400): string {
  return `/img/${photoId}/${photoFilename(width)}`
}
