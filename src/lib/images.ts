import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

export const WIDTHS = [400, 800, 1600] as const
export const MAX_BYTES = 12 * 1024 * 1024
export const MAX_PHOTOS_PER_ITEM = 10

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

function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? '/data/uploads'
}

export function itemDir(itemId: string): string {
  return path.join(uploadDir(), itemId)
}

export function photoFilename(photoId: string, width: number): string {
  return `${photoId}-${width}.webp`
}

export async function storePhoto(buf: Buffer, itemId: string, photoId: string) {
  const dir = itemDir(itemId)
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
      const filePath = path.join(dir, photoFilename(photoId, w))
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
 * Removes every width variant of one photo. Used on error paths — e.g. when
 * storePhoto succeeded but the Photo row was never created — so it must
 * never throw itself; a cleanup failure here would replace the caller's
 * real error with an unrelated one.
 */
export async function deletePhotoFiles(itemId: string, photoId: string): Promise<void> {
  const dir = itemDir(itemId)
  await Promise.all(
    WIDTHS.map((w) => rm(path.join(dir, photoFilename(photoId, w)), { force: true }).catch(() => {})),
  )
}

export async function deleteItemPhotos(itemId: string): Promise<void> {
  await rm(itemDir(itemId), { recursive: true, force: true })
}
