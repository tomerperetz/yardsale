import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { MAX_BYTES, MAX_PHOTOS_PER_ITEM, sniffImageType, storePhoto } from '@/lib/images'

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
  // (/^[a-z0-9]+-(400|800|1600)\.webp$/) with no risk of stray characters.
  return randomBytes(12).toString('hex')
}

export async function POST(req: NextRequest) {
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
    if (!sniffImageType(buf)) {
      errors.push(`${file.name}: קובץ לא מזוהה כתמונה`)
      continue
    }

    const id = photoId()
    const { width, height, lqip } = await storePhoto(buf, itemId, id)

    const takenAtRaw = takenAtValues[i]
    const takenAt = takenAtRaw ? takenAtSchema.parse(takenAtRaw) : undefined

    await db.photo.create({
      data: {
        id,
        itemId,
        width,
        height,
        lqip,
        position: count,
        ...(takenAt ? { takenAt: new Date(takenAt) } : {}),
      },
    })

    photos.push({ id, lqip, width, height })
    count += 1
  }

  return NextResponse.json({ photos, errors })
}
