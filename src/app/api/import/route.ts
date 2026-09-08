import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { deletePhotoFiles, sniffImageType, storePhoto } from '@/lib/images'
import { MAX_BYTES, MAX_IMPORT_FILES, MAX_IMPORT_REQUEST_BYTES } from '@/lib/photo-url'
import { hit } from '@/lib/rate-limit'

// Authenticated via src/middleware.ts (matcher includes /api/import) —
// an unauthenticated request never reaches this handler.

/**
 * Intake for the AI import: the seller drops a whole sale's worth of photos and
 * this stores them and returns, so the client can show thumbnails while
 * clustering runs separately (clusterBatch). The photos are written with an
 * importBatchId and NO itemId — nothing yet knows which product each shows.
 *
 * One drop is many requests. The client posts IMPORT_CHUNK_FILES photos at a
 * time (spec §7.1, and the reasoning is on that constant): the first request
 * carries no batch id and the response mints one, every request after it sends
 * that id back and its photos join the same batch. So everything bounding a
 * batch — the cap and the position numbering — counts what the batch already
 * holds, never what one request carries.
 *
 * Deliberately unlike /api/upload in one way: MAX_PHOTOS_PER_ITEM does not
 * apply. A cluster has no cap, and the seller who took twelve shots of one sofa
 * must not lose two of them. MAX_IMPORT_FILES bounds the batch, and the byte
 * ceiling bounds one request; nothing bounds a cluster.
 *
 * The client sends the files under "files" and, for each file at the same
 * index, a "takenAt" field (an ISO datetime string, or empty when unknown).
 * The two arrays stay aligned by position — form-data preserves field order,
 * and formData.getAll() returns entries in the order they were appended. It is
 * kept even though clustering is what groups these photos: when the AI call
 * fails, clusterBatch falls back to grouping by capture time, and a takenAt
 * that was never recorded at intake cannot be recovered afterwards.
 */
const takenAtSchema = z.string().datetime().optional().catch(undefined)

function newId(): string {
  // Lowercase hex, like the ids /api/upload mints: it satisfies PHOTO_ID_RE
  // (the only thing that may become a directory name under UPLOAD_DIR) and is
  // safe as a URL path segment, which the batch id becomes at
  // /admin/items/import/[batchId]. Not literally a cuid — the schema's cuids
  // come from Prisma's own generator, and there is no standalone one in this
  // project to call for an id that is not a row id.
  return randomBytes(12).toString('hex')
}

/**
 * Exactly what newId() mints — twelve random bytes as lowercase hex. A batch
 * id after the first chunk comes back from the client, and it becomes a URL
 * segment at /admin/items/import/[batchId], so it is checked against the shape
 * this server mints rather than merely being non-empty.
 *
 * It is NOT checked against the database: there is no ImportBatch table, and a
 * batch exists only as the id its photos carry, so the first chunk of a batch
 * has nothing to match. An authenticated seller choosing their own well-shaped
 * id groups their own photos under it, which is what the field is for.
 *
 * The route's own minting is what keeps this honest: the two are pinned
 * together by the round-trip test, which posts a minted id straight back.
 */
const BATCH_ID_RE = /^[0-9a-f]{24}$/

export async function POST(req: NextRequest) {
  // Authenticated, so this is not what keeps strangers out — the middleware
  // is. It bounds how much sharp work one caller can queue, in its own
  // namespace so that an import cannot spend the seller's login budget.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  const limit = hit(ip, Date.now(), 'import')
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } },
    )
  }

  // request.formData() buffers the entire multipart body before any per-file
  // check can run, and Route Handlers impose no default body limit — reject
  // an oversized request up front. Content-Length can be absent on a
  // chunked request; when it is, the per-file caps below remain the backstop.
  const contentLength = req.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_IMPORT_REQUEST_BYTES) {
    return NextResponse.json({ error: 'הבקשה גדולה מדי. נסו להעלות פחות תמונות בבת אחת.' }, { status: 413 })
  }

  const form = await req.formData()

  const files = form.getAll('files').filter((v): v is File => v instanceof File)
  const takenAtValues = form.getAll('takenAt').map((v) => (typeof v === 'string' ? v : ''))

  if (files.length === 0) {
    return NextResponse.json({ error: 'no files provided' }, { status: 400 })
  }

  // Absent on the first chunk of a drop — that request is what mints the id
  // the rest of them carry back.
  const batchIdRaw = form.get('batchId')
  if (batchIdRaw !== null && (typeof batchIdRaw !== 'string' || !BATCH_ID_RE.test(batchIdRaw))) {
    return NextResponse.json({ error: 'invalid batchId' }, { status: 400 })
  }
  const batchId = batchIdRaw ?? newId()

  // Both the cap and the position numbering count what the batch already
  // holds, not what this request carries: six photos at a time means ten
  // requests build one 60-photo batch, so a per-request check would bound
  // nothing and per-request numbering would give every chunk positions 0-5.
  const existing = await db.photo.count({ where: { importBatchId: batchId } })

  // Counted before anything is written, so an over-sized batch leaves no half
  // a chunk behind for the seller to find and clean up.
  if (existing + files.length > MAX_IMPORT_FILES) {
    return NextResponse.json(
      { error: `יותר מדי תמונות בבת אחת. אפשר עד ${MAX_IMPORT_FILES}.` },
      { status: 400 },
    )
  }

  const photos: { id: string; lqip: string; width: number; height: number }[] = []
  const errors: string[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]

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

    const id = newId()

    // A file that sniffs as an image but fails to decode (a corrupt upload,
    // or a HEIC variant this build's libvips can't read) must not abort the
    // rest of the batch — storePhoto guarantees it leaves nothing on disk
    // when it throws, so it's safe to just record the failure and move on.
    // `stored` distinguishes a decode failure (nothing written) from a
    // failure after storePhoto succeeded (files written, but the Photo row
    // was never created) — the latter must clean up its own files too.
    let stored: Awaited<ReturnType<typeof storePhoto>> | null = null
    try {
      stored = await storePhoto(buf, id)

      const takenAtRaw = takenAtValues[i]
      const takenAt = takenAtRaw ? takenAtSchema.parse(takenAtRaw) : undefined

      await db.photo.create({
        data: {
          id,
          importBatchId: batchId,
          width: stored.width,
          height: stored.height,
          lqip: stored.lqip,
          // Drop order across the whole batch, over the photos that made it —
          // continued from what the batch already holds, the way /api/upload
          // continues from its item's count. clusterBatch reads the batch
          // `orderBy: position` and renumbers within each item once it knows
          // the groups, so two chunks sharing positions 0-5 would not lose a
          // photo but would scramble the order Claude sees them in.
          //
          // Chunks must therefore be posted one at a time: two in flight at
          // once read the same `existing` and collide. There is no unique
          // constraint on (importBatchId, position) to serialize against, and
          // adding one to make a single seller's sequential uploads safe
          // against themselves is not worth the migration.
          position: existing + photos.length,
          ...(takenAt ? { takenAt: new Date(takenAt) } : {}),
        },
      })

      photos.push({ id, lqip: stored.lqip, width: stored.width, height: stored.height })
    } catch {
      if (stored) await deletePhotoFiles(id)
      errors.push(
        stored
          ? `${file.name}: שגיאה בשמירת התמונה. נסו שוב.`
          : sniffed === 'heic'
            ? `${file.name}: לא הצלחנו לקרוא קובץ HEIC. באייפון: הגדרות ← מצלמה ← פורמטים ← ״הכי תואם״, ואז לצלם מחדש, או להמיר את הקובץ ל‑JPEG.`
            : `${file.name}: לא הצלחנו לקרוא את הקובץ.`,
      )
    }
  }

  return NextResponse.json({ batchId, photos, errors })
}
