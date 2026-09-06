import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { deletePhotoFiles, sniffImageType, storePhoto } from '@/lib/images'
import { MAX_BYTES, MAX_PHOTOS_PER_ITEM, MAX_REQUEST_BYTES } from '@/lib/photo-url'

// Authenticated via src/middleware.ts (matcher includes /api/upload) —
// an unauthenticated request never reaches this handler.

const itemIdSchema = z.string().min(1)

/**
 * The client sends one or more files under the "files" field and, for each
 * file at the same index, a "takenAt" field (an ISO datetime string, or an
 * empty string when unknown/unavailable). The two arrays must stay aligned
 * by position — form-data preserves field order, and formData.getAll()
 * returns entries in the order they were appended.
 */
const takenAtSchema = z
  .string()
  .datetime()
  .optional()
  .catch(undefined)

function photoId(): string {
  // Lowercase hex only, so it satisfies the serving route's filename regex
  // (src/app/img/[itemId]/[file]/route.ts) with no risk of stray characters.
  return randomBytes(12).toString('hex')
}

export async function POST(req: NextRequest) {
  // request.formData() buffers the entire multipart body before any per-file
  // check can run, and Route Handlers impose no default body limit — reject
  // an oversized request up front. Content-Length can be absent on a
  // chunked request; when it is, the per-file caps below remain the backstop.
  const contentLength = req.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'הבקשה גדולה מדי. נסו להעלות פחות תמונות בבת אחת.' }, { status: 413 })
  }

  const form = await req.formData()

  const itemIdRaw = form.get('itemId')
  const parsedItemId = itemIdSchema.safeParse(itemIdRaw)
  if (!parsedItemId.success) {
    return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
  }
  const itemId = parsedItemId.data

  const item = await db.item.findUnique({ where: { id: itemId }, select: { id: true } })
  if (!item) {
    return NextResponse.json({ error: 'item not found' }, { status: 404 })
  }

  const files = form.getAll('files').filter((v): v is File => v instanceof File)
  const takenAtValues = form.getAll('takenAt').map((v) => (typeof v === 'string' ? v : ''))

  if (files.length === 0) {
    return NextResponse.json({ error: 'no files provided' }, { status: 400 })
  }

  let count = await db.photo.count({ where: { itemId } })

  const photos: { id: string; lqip: string; width: number; height: number }[] = []
  const errors: string[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]

    if (count >= MAX_PHOTOS_PER_ITEM) {
      errors.push(`${file.name}: הפריט כבר מכיל ${MAX_PHOTOS_PER_ITEM} תמונות`)
      continue
    }

    // Check the declared size before reading the whole file into memory.
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name}: הקובץ גדול מדי`)
      continue
    }

    const buf = Buffer.from(await file.arrayBuffer())

    // Belt and suspenders: re-check the actual byte length, never trust
    // metadata alone, and never trust the declared MIME type or extension —
    // decide the file type by sniffing magic bytes.
    if (buf.byteLength > MAX_BYTES) {
      errors.push(`${file.name}: הקובץ גדול מדי`)
      continue
    }
    const sniffed = sniffImageType(buf)
    if (!sniffed) {
      errors.push(`${file.name}: קובץ לא מזוהה כתמונה`)
      continue
    }

    const id = photoId()

    // A file that sniffs as an image but fails to decode (a corrupt upload,
    // or a HEIC variant this build's libvips can't read) must not abort the
    // rest of the batch — storePhoto guarantees it leaves nothing on disk
    // when it throws, so it's safe to just record the failure and move on.
    // `stored` distinguishes a decode failure (nothing written) from a
    // failure after storePhoto succeeded (files written, but the Photo row
    // was never created) — the latter must clean up its own files too.
    let stored: Awaited<ReturnType<typeof storePhoto>> | null = null
    try {
      stored = await storePhoto(buf, itemId, id)

      const takenAtRaw = takenAtValues[i]
      const takenAt = takenAtRaw ? takenAtSchema.parse(takenAtRaw) : undefined

      await db.photo.create({
        data: {
          id,
          itemId,
          width: stored.width,
          height: stored.height,
          lqip: stored.lqip,
          position: count,
          ...(takenAt ? { takenAt: new Date(takenAt) } : {}),
        },
      })

      photos.push({ id, lqip: stored.lqip, width: stored.width, height: stored.height })
      count += 1
    } catch {
      if (stored) await deletePhotoFiles(itemId, id)
      errors.push(
        stored
          ? `${file.name}: שגיאה בשמירת התמונה. נסו שוב.`
          : sniffed === 'heic'
            ? `${file.name}: לא הצלחנו לקרוא קובץ HEIC. באייפון: הגדרות ← מצלמה ← פורמטים ← ״הכי תואם״, ואז לצלם מחדש, או להמיר את הקובץ ל‑JPEG.`
            : `${file.name}: לא הצלחנו לקרוא את הקובץ.`,
      )
    }
  }

  return NextResponse.json({ photos, errors })
}
