import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { WIDTHS, photoFilename } from '@/lib/photo-url'

// Re-exported so a caller doing image work has one import: the definitions
// live in src/lib/photo-url.ts, which client components can import and this
// module (sharp) cannot be.
export { WIDTHS, photoFilename }

const MAGIC: [Buffer, 'jpeg' | 'png' | 'webp' | 'heic'][] = [
  [Buffer.from([0xff, 0xd8, 0xff]), 'jpeg'],
  [Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'png'],
]

/** Never trust a declared MIME type; look at the bytes. */
export function sniffImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'heic' | null {
  for (const [magic, type] of MAGIC) {
    if (buf.subarray(0, magic.length).equals(magic)) return type
  }
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  const brand = buf.subarray(4, 12).toString('ascii')
  if (brand.startsWith('ftypheic') || brand.startsWith('ftypmif1')) return 'heic'
  return null
}

/**
 * The volume every photo directory sits in. Exported so the one-shot layout
 * migration (scripts/migrate-photo-layout.ts) can find the old item-keyed
 * directories without restating the default and drifting from it.
 */
export function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? '/data/uploads'
}

/**
 * One photo owns one directory. Keyed by the photo and not by its item, so a
 * photo can be stored before anything knows which product it shows, and moving
 * one between items is a database UPDATE with no file I/O to half-fail.
 */
export function photoDir(photoId: string): string {
  return path.join(uploadDir(), photoId)
}

export async function storePhoto(buf: Buffer, photoId: string) {
  const dir = photoDir(photoId)
  await mkdir(dir, { recursive: true })

  const written: string[] = []
  try {
    // rotate() applies the EXIF orientation flag, and the re-encode drops all metadata,
    // which is also how GPS coordinates from a phone photo are removed.
    const base = sharp(buf).rotate()
    const meta = await base.metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0

    for (const w of WIDTHS) {
      const out = await sharp(buf)
        .rotate()
        .resize({ width: Math.min(w, width || w), withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()
      const filePath = path.join(dir, photoFilename(w))
      await writeFile(filePath, out)
      written.push(filePath)
    }

    const blur = await sharp(buf).rotate().resize({ width: 16 }).webp({ quality: 30 }).toBuffer()

    return { width, height, lqip: `data:image/webp;base64,${blur.toString('base64')}` }
  } catch (err) {
    // A failure partway through must never leave a partial width set on disk
    // with no Photo row pointing at it — remove whatever this call already
    // wrote before propagating the error. A cleanup failure must never mask
    // the original error, so each removal swallows its own errors.
    await Promise.all(written.map((f) => rm(f, { force: true }).catch(() => {})))
    throw err
  }
}

/**
 * Removes every width variant of one photo — the whole directory, which is
 * this photo's alone. Used on error paths — e.g. when storePhoto succeeded but
 * the Photo row was never created — so it must never throw itself; a cleanup
 * failure here would replace the caller's real error with an unrelated one.
 *
 * There is deliberately no "delete every photo of this item": once storage is
 * keyed by photo, an item's photos are not one directory. A caller deleting an
 * item must collect its photo ids first — see deleteItem in
 * src/lib/admin/items.ts, which reads them inside its transaction, before the
 * rows that name them are gone.
 */
export async function deletePhotoFiles(photoId: string): Promise<void> {
  await rm(photoDir(photoId), { recursive: true, force: true }).catch(() => {})
}
