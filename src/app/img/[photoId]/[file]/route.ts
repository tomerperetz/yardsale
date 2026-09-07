import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { photoDir } from '@/lib/images'
import { PHOTO_ID_RE, WIDTHS } from '@/lib/photo-url'

// Built from WIDTHS rather than restating them: a width added there must not
// silently 404 here. The widths are plain integers, so nothing needs escaping.
const FILE_RE = new RegExp(`^(${WIDTHS.join('|')})\\.webp$`)

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

export async function GET(_req: Request, { params }: { params: Promise<{ photoId: string; file: string }> }) {
  const { photoId, file } = await params

  // Validate BEFORE touching the filesystem — a crafted photoId or file must
  // never escape the photo's directory.
  if (!PHOTO_ID_RE.test(photoId) || !FILE_RE.test(file)) return notFound()

  const dir = path.resolve(photoDir(photoId))
  const filePath = path.resolve(dir, file)

  // Defense in depth: even though the regexes above already rule out "..",
  // slashes and null bytes, confirm the resolved path is still inside the
  // photo directory before opening anything.
  if (filePath !== path.join(dir, file) || (filePath !== dir && !filePath.startsWith(dir + path.sep))) {
    return notFound()
  }

  const stats = await stat(filePath).catch(() => null)
  if (!stats || !stats.isFile()) return notFound()

  const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(stats.size),
    },
  })
}
