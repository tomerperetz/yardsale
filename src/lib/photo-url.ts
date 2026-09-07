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
