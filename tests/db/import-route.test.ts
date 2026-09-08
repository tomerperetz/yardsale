import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { NextRequest } from 'next/server'
import { middleware, config } from '@/middleware'
import { POST } from '@/app/api/import/route'
import { db } from '@/lib/db'
import { photoFilename, WIDTHS, MAX_BYTES, MAX_IMPORT_FILES, MAX_IMPORT_REQUEST_BYTES } from '@/lib/photo-url'
import { __resetRateLimit } from '@/lib/rate-limit'
import { resetDb } from '../helpers/db'

let dir: string

beforeEach(async () => {
  await resetDb()
  __resetRateLimit()
  dir = await mkdtemp(path.join(tmpdir(), 'ys-import-'))
  process.env.UPLOAD_DIR = dir
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const jpeg = (width = 1200, height = 900) =>
  sharp({ create: { width, height, channels: 3, background: '#888' } }).jpeg().toBuffer()

/** Valid HEIC magic bytes, undecodable body: sniffs as heic, sharp cannot read it. */
const fakeHeic = () => Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(64)])

type Part = { name: string; body: Buffer | string; takenAt?: string }

/** A Buffer is backed by a pooled ArrayBufferLike, which File's types reject. */
const blobPart = (body: Buffer | string): BlobPart => (typeof body === 'string' ? body : new Uint8Array(body))

function importRequest(parts: Part[], headers: Record<string, string> = {}, batchId?: string): NextRequest {
  const form = new FormData()
  if (batchId !== undefined) form.append('batchId', batchId)
  for (const p of parts) {
    form.append('files', new File([blobPart(p.body)], p.name, { type: 'image/jpeg' }))
    form.append('takenAt', p.takenAt ?? '')
  }
  return new NextRequest('http://localhost/api/import', { method: 'POST', body: form, headers })
}

async function post(parts: Part[], headers: Record<string, string> = {}, batchId?: string) {
  const res = await POST(importRequest(parts, headers, batchId))
  return { status: res.status, body: (await res.json()) as { batchId?: string; photos?: { id: string; lqip: string; width: number; height: number }[]; errors?: string[]; error?: string } }
}

/**
 * The route is authenticated by src/middleware.ts alone, and that matcher is a
 * literal list — /api/import is open to the whole internet until it appears in
 * it. An unguarded multipart endpoint lets anyone write files to the seller's
 * disk, so the guard is proven here, next to the route it protects.
 */
describe('the guard on /api/import', () => {
  it('runs the middleware on the route at all', () => {
    expect(config.matcher).toContain('/api/import')
  })

  it('rejects an unauthenticated request with 401 rather than redirecting it', async () => {
    const res = middleware(new NextRequest('http://localhost/api/import', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })
})

describe('POST /api/import', () => {
  it('refuses more than 60 files in one batch, before writing anything', async () => {
    const parts = Array.from({ length: MAX_IMPORT_FILES + 1 }, (_, i) => ({ name: `p${i}.jpg`, body: 'x' }))

    const { status, body } = await post(parts)

    expect(status).toBe(400)
    expect(body.error).toBe('יותר מדי תמונות בבת אחת. אפשר עד 60.')
    expect(await db.photo.count()).toBe(0)
    expect(await readdir(dir)).toEqual([])
  })

  it('accepts a batch of exactly 60', async () => {
    // Bodies that are not images: each fails per file, which is the point —
    // the batch itself is not refused, so 60 is inside the cap.
    const parts = Array.from({ length: MAX_IMPORT_FILES }, (_, i) => ({ name: `p${i}.jpg`, body: 'x' }))

    const { status, body } = await post(parts)

    expect(status).toBe(200)
    expect(body.errors).toHaveLength(MAX_IMPORT_FILES)
  })

  it('stores every photo of a good batch under one batch id, with no item yet', async () => {
    const buf = await jpeg()

    const { status, body } = await post([
      { name: 'a.jpg', body: buf },
      { name: 'b.jpg', body: buf },
      { name: 'c.jpg', body: buf },
    ])

    expect(status).toBe(200)
    expect(body.errors).toEqual([])
    expect(body.batchId).toMatch(/^[a-z0-9]+$/)
    expect(body.photos).toHaveLength(3)

    const rows = await db.photo.findMany({ orderBy: { position: 'asc' } })
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.itemId === null)).toBe(true)
    expect(rows.every((r) => r.importBatchId === body.batchId)).toBe(true)
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2])
    expect(rows.map((r) => r.id).sort()).toEqual(body.photos!.map((p) => p.id).sort())
    expect(rows.every((r) => r.width === 1200 && r.height === 900)).toBe(true)
    expect(body.photos!.every((p) => p.lqip.startsWith('data:image/webp;base64,'))).toBe(true)
  })

  it('writes every width to the photo directory', async () => {
    const { body } = await post([{ name: 'a.jpg', body: await jpeg() }])

    const files = await readdir(path.join(dir, body.photos![0].id))
    expect(files.sort()).toEqual(WIDTHS.map((w) => photoFilename(w)).sort())
  })

  it('records the capture time the client sends, for the grouping fallback', async () => {
    const { body } = await post([{ name: 'a.jpg', body: await jpeg(), takenAt: '2026-09-07T10:11:12.000Z' }])

    const row = await db.photo.findUniqueOrThrow({ where: { id: body.photos![0].id } })
    expect(row.takenAt?.toISOString()).toBe('2026-09-07T10:11:12.000Z')
  })

  it('reports one bad file and keeps the rest of the batch', async () => {
    const buf = await jpeg()

    const { status, body } = await post([
      { name: 'good.jpg', body: buf },
      { name: 'broken.jpg', body: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('not a png')]) },
      { name: 'also-good.jpg', body: buf },
    ])

    expect(status).toBe(200)
    expect(body.photos).toHaveLength(2)
    expect(body.errors).toHaveLength(1)
    expect(body.errors![0]).toContain('broken.jpg')
    expect(await db.photo.count()).toBe(2)
    // Nothing left on disk for the file that failed.
    expect(await readdir(dir)).toHaveLength(2)
  })

  it('numbers the survivors consecutively when a file in the middle fails', async () => {
    const buf = await jpeg()

    const { body } = await post([
      { name: 'good.jpg', body: buf },
      { name: 'broken.jpg', body: 'x' },
      { name: 'also-good.jpg', body: buf },
    ])

    const rows = await db.photo.findMany({ orderBy: { position: 'asc' } })
    expect(rows.map((r) => r.position)).toEqual([0, 1])
    expect(body.photos!.map((p) => p.id)).toEqual(rows.map((r) => r.id))
  })

  it('tells an iPhone seller what to do about a HEIC it cannot read', async () => {
    const { body } = await post([{ name: 'IMG_0001.HEIC', body: fakeHeic() }])

    expect(body.photos).toEqual([])
    expect(body.errors![0]).toContain('IMG_0001.HEIC')
    expect(body.errors![0]).toContain('HEIC')
    expect(body.errors![0]).toContain('הכי תואם')
  })

  it('rejects a file that is not an image at all', async () => {
    const { body } = await post([{ name: 'shell.jpg', body: '<?php echo 1; ?>' }])

    expect(body.errors).toEqual(['shell.jpg: קובץ לא מזוהה כתמונה'])
    expect(await db.photo.count()).toBe(0)
  })

  it('rejects one oversized file without reading it', async () => {
    const { body } = await post([{ name: 'huge.jpg', body: Buffer.alloc(MAX_BYTES + 1) }])

    expect(body.errors).toEqual(['huge.jpg: הקובץ גדול מדי'])
    expect(await db.photo.count()).toBe(0)
  })

  it('refuses an oversized request up front, before buffering it', async () => {
    const { status, body } = await post([{ name: 'a.jpg', body: 'x' }], {
      'content-length': String(MAX_IMPORT_REQUEST_BYTES + 1),
    })

    expect(status).toBe(413)
    expect(body.error).toBe('הבקשה גדולה מדי. נסו להעלות פחות תמונות בבת אחת.')
  })

  it('refuses a request carrying no files', async () => {
    const { status } = await post([])
    expect(status).toBe(400)
  })

  it('throttles one caller past their allowance, in its own namespace', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }

    // Ten of these is one drop, at six photos a request. The allowance has to
    // outlast a drop with retries to spare, so it is well past ten.
    for (let i = 0; i < 40; i++) {
      expect((await post([], ip)).status).toBe(400)
    }

    const { status, body } = await post([], ip)
    expect(status).toBe(429)
    expect(body.error).toBe('יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.')
  })
})

/**
 * A drop is IMPORT_CHUNK_FILES photos per request, so nearly everything that
 * bounds or orders a batch has to count the batch and not the request. Getting
 * this wrong is silent: every chunk succeeds, and the damage is positions that
 * collide inside one batch — which clusterBatch reads `orderBy: position`, so
 * it scrambles the order Claude is shown the photos in — and a cap that bounds
 * nothing at all.
 */
describe('POST /api/import across the chunks of one drop', () => {
  const seedBatch = async (batchId: string, count: number) =>
    db.photo.createMany({
      data: Array.from({ length: count }, (_, i) => ({ importBatchId: batchId, width: 8, height: 6, lqip: 'x', position: i })),
    })

  it('joins a second chunk to the batch the first one minted', async () => {
    const buf = await jpeg()

    const first = await post([{ name: 'a.jpg', body: buf }, { name: 'b.jpg', body: buf }])
    // The id goes back exactly as it came: this is also what pins the route's
    // validator to the shape the route itself mints.
    const second = await post([{ name: 'c.jpg', body: buf }, { name: 'd.jpg', body: buf }], {}, first.body.batchId)

    expect(second.status).toBe(200)
    expect(second.body.batchId).toBe(first.body.batchId)
    expect(await db.photo.count({ where: { importBatchId: first.body.batchId } })).toBe(4)
  })

  it('numbers the second chunk after the first instead of colliding with it', async () => {
    const buf = await jpeg()

    const first = await post([{ name: 'a.jpg', body: buf }, { name: 'b.jpg', body: buf }])
    const second = await post([{ name: 'c.jpg', body: buf }, { name: 'd.jpg', body: buf }], {}, first.body.batchId)

    const rows = await db.photo.findMany({ where: { importBatchId: first.body.batchId }, orderBy: { position: 'asc' } })
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3])
    expect(new Set(rows.map((r) => r.position)).size).toBe(4)
    // Contiguous AND in drop order: the four ids in the order they were sent.
    expect(rows.map((r) => r.id)).toEqual([...first.body.photos!, ...second.body.photos!].map((p) => p.id))
  })

  it('refuses the photo that would be the batch 61st, however it is chunked', async () => {
    const batchId = 'a'.repeat(24)
    await seedBatch(batchId, MAX_IMPORT_FILES)

    const { status, body } = await post([{ name: 'one-too-many.jpg', body: await jpeg() }], {}, batchId)

    expect(status).toBe(400)
    expect(body.error).toBe('יותר מדי תמונות בבת אחת. אפשר עד 60.')
    expect(await db.photo.count({ where: { importBatchId: batchId } })).toBe(MAX_IMPORT_FILES)
  })

  it('refuses the whole chunk when only its last photo would be over the cap', async () => {
    const batchId = 'b'.repeat(24)
    await seedBatch(batchId, MAX_IMPORT_FILES - 2)
    const buf = await jpeg()

    const { status } = await post([{ name: 'a.jpg', body: buf }, { name: 'b.jpg', body: buf }, { name: 'c.jpg', body: buf }], {}, batchId)

    expect(status).toBe(400)
    expect(await db.photo.count({ where: { importBatchId: batchId } })).toBe(MAX_IMPORT_FILES - 2)
  })

  it('accepts the photo that makes the batch exactly 60', async () => {
    const batchId = 'c'.repeat(24)
    await seedBatch(batchId, MAX_IMPORT_FILES - 1)

    const { status } = await post([{ name: 'last.jpg', body: await jpeg() }], {}, batchId)

    expect(status).toBe(200)
    expect(await db.photo.count({ where: { importBatchId: batchId } })).toBe(MAX_IMPORT_FILES)
  })

  it('counts each batch on its own', async () => {
    const full = 'd'.repeat(24)
    await seedBatch(full, MAX_IMPORT_FILES)

    const { status } = await post([{ name: 'a.jpg', body: await jpeg() }])

    expect(status).toBe(200)
  })

  it('refuses a batch id it did not mint the shape of', async () => {
    for (const bad of ['', 'not-a-batch', 'A'.repeat(24), 'a'.repeat(23), 'a'.repeat(25), '../../etc/passwd', 'a'.repeat(12) + '/..']) {
      const { status, body } = await post([{ name: 'a.jpg', body: 'x' }], {}, bad)
      expect(status, `batchId ${JSON.stringify(bad)}`).toBe(400)
      expect(body.error).toBe('invalid batchId')
    }
    expect(await db.photo.count()).toBe(0)
  })
})
