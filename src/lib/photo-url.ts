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

/** The file one width of one photo is stored as, on disk and in the URL. */
export function photoFilename(photoId: string, width: number): string {
  return `${photoId}-${width}.webp`
}

/** Where the browser fetches one width of one photo — see src/app/img/[itemId]/[file]/route.ts. */
export function photoUrl(itemId: string, photoId: string, width: PhotoWidth = 400): string {
  return `/img/${itemId}/${photoFilename(photoId, width)}`
}
