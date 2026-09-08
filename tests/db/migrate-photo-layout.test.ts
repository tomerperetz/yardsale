import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@/lib/db'
import { WIDTHS } from '@/lib/photo-url'
import { resetDb } from '../helpers/db'
import { makeItem } from '../helpers/factories'

/**
 * The layout migration, run the way a deploy runs it — as the script, through
 * its argv, and checked by its exit code.
 *
 * It is spawned rather than imported because the contract under test is the
 * command: which pass `--cleanup` selects, and whether a run with gaps exits
 * non-zero so a deploy step calling it stops instead of reading a summary
 * scrolling past as success.
 */

const SCRIPT = path.join(process.cwd(), 'scripts', 'migrate-photo-layout.ts')
const TSX = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')

let uploads: string

beforeEach(async () => {
  await resetDb()
  uploads = await mkdtemp(path.join(tmpdir(), 'ys-migrate-'))
})

afterEach(() => rm(uploads, { recursive: true, force: true }))

function migrate(...args: string[]) {
  const result = spawnSync(TSX, [SCRIPT, ...args], {
    env: { ...process.env, UPLOAD_DIR: uploads },
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  return result
}

const oldPath = (itemId: string, photoId: string, width: number) =>
  path.join(uploads, itemId, `${photoId}-${width}.webp`)

const newPath = (photoId: string, width: number) => path.join(uploads, photoId, `${width}.webp`)

/** A photo row with all its widths on disk in the OLD, item-keyed layout. */
async function makeOldPhoto(itemId: string) {
  const photo = await db.photo.create({
    data: { itemId, width: 800, height: 600, lqip: 'x', position: 0 },
  })
  await mkdir(path.join(uploads, itemId), { recursive: true })
  for (const width of WIDTHS) {
    await writeFile(oldPath(itemId, photo.id, width), `bytes of ${photo.id} at ${width}`)
  }
  return photo
}

describe('the photo layout migration', () => {
  it('copies without removing anything, so both layouts are readable at once', async () => {
    // The property the whole two-pass split exists for. The old build serves
    // <itemId>/<photoId>-<width>.webp and the new one <photoId>/<width>.webp;
    // if this pass unlinked as it went there would be no moment at which both
    // are readable, and the migration would have to run either just before the
    // deploy (photos 404 until it finishes) or just after (photos 404 until
    // someone remembers an undocumented command).
    const item = await makeItem()
    const photo = await makeOldPhoto(item.id)

    const first = migrate()
    expect(first.status).toBe(0)

    for (const width of WIDTHS) {
      expect(existsSync(oldPath(item.id, photo.id, width))).toBe(true)
      expect(existsSync(newPath(photo.id, width))).toBe(true)
      expect(await readFile(newPath(photo.id, width), 'utf8')).toBe(`bytes of ${photo.id} at ${width}`)
    }

    // And a second run is a no-op rather than a re-copy.
    const second = migrate()
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('files copied this run: 0')
    for (const width of WIDTHS) {
      expect(await readFile(newPath(photo.id, width), 'utf8')).toBe(`bytes of ${photo.id} at ${width}`)
    }
  })

  it('removes an original only once its copy is verified, and says so when it will not', async () => {
    const copied = await makeItem()
    const notCopied = await makeItem()
    const good = await makeOldPhoto(copied.id)
    const orphan = await makeOldPhoto(notCopied.id)

    expect(migrate().status).toBe(0)

    // Simulate the copy never having reached this one — a volume that came
    // back short, or a cleanup run reaching production before the copy did.
    await rm(path.join(uploads, orphan.id), { recursive: true, force: true })

    const result = migrate('--cleanup')

    // Loud: a photo whose original cannot be safely removed must stop a
    // scripted deploy step rather than scroll past it.
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(orphan.id)

    for (const width of WIDTHS) {
      // The verified one went, files and now-empty item directory.
      expect(existsSync(oldPath(copied.id, good.id, width))).toBe(false)
      expect(existsSync(newPath(good.id, width))).toBe(true)
      // The unverified one was left exactly as it was: this pass deletes, it
      // does not repair, so it must never remove an original on the strength
      // of a copy that is not there.
      expect(existsSync(oldPath(notCopied.id, orphan.id, width))).toBe(true)
    }

    expect(existsSync(path.join(uploads, copied.id))).toBe(false)
    expect(existsSync(path.join(uploads, notCopied.id))).toBe(true)
  })

  it('reports a photo whose files are gone from both layouts instead of throwing', async () => {
    const item = await makeItem()
    const ghost = await db.photo.create({
      data: { itemId: item.id, width: 800, height: 600, lqip: 'x', position: 0 },
    })

    const result = migrate()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(ghost.id)
  })
})
