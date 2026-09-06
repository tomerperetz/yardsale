import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { itemDir } from '@/lib/images'

const ITEM_ID_RE = /^[a-z0-9]+$/
const FILE_RE = /^[a-z0-9]+-(400|800|1600)\.webp$/

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

export async function GET(_req: Request, { params }: { params: Promise<{ itemId: string; file: string }> }) {
  const { itemId, file } = await params

  // Validate BEFORE touching the filesystem — a crafted itemId or file must
  // never escape the item's directory.
  if (!ITEM_ID_RE.test(itemId) || !FILE_RE.test(file)) return notFound()

  const dir = path.resolve(itemDir(itemId))
  const filePath = path.resolve(dir, file)

  // Defense in depth: even though the regexes above already rule out "..",
  // slashes and null bytes, confirm the resolved path is still inside the
  // item directory before opening anything.
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
