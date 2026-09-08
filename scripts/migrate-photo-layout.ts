/**
 * One-shot, in two passes: move every photo's files from the old item-keyed
 * layout to the photo-keyed one.
 *
 *   <UPLOAD_DIR>/<itemId>/<photoId>-<width>.webp  →  <UPLOAD_DIR>/<photoId>/<width>.webp
 *
 *   npm run migrate:photos              # pass 1, before the deploy: copy. Removes nothing.
 *   npm run migrate:photos -- --cleanup # pass 2, after it: remove the copied originals.
 *
 * **Two passes, because one has no safe moment to run.** This is a code change
 * as much as a disk change: the old build asks for
 * `<itemId>/<photoId>-<width>.webp` and the new one for
 * `<photoId>/<width>.webp`, and neither reads the other's path. A single
 * move-and-unlink pass leaves no instant at which both are readable, so it
 * could only run just before the deploy — every photo 404s until it finishes —
 * or just after, with every photo 404ing until someone remembers a command
 * that is written down nowhere. Copying first puts both layouts on disk at
 * once: pass 1 runs against the running old build with nothing broken, the
 * deploy switches which path is read, and pass 2 reclaims the space once
 * photos are confirmed rendering. Skipping pass 2 costs disk and nothing else,
 * which is the right way round for the pass that deletes.
 *
 * Three properties, all load-bearing:
 *
 * - **Idempotent, and it finishes what it started.** A width is copied to
 *   `<width>.webp.tmp` and then renamed into place, and rename is atomic within
 *   one filesystem — so `<width>.webp` either does not exist or is a complete
 *   file, never a half-written one. "Destination exists" alone is not enough to
 *   call a width done: while the original is still there the two are compared,
 *   and a destination that does not match is rewritten from it. That is what
 *   makes an interrupted run actually finish on the next one rather than
 *   blessing whatever it finds. (A stray `.tmp` from a killed run is
 *   overwritten by the next copy, and the serving route's filename regex never
 *   matches it, so one can never be served.)
 * - **Never destructive.** Pass 1 removes nothing at all. Pass 2 removes an
 *   original only once the copy is in place with the same byte length, and
 *   refuses — loudly — where it is not, rather than repairing it: a pass whose
 *   job is deleting must not also be the pass that decides a copy is good
 *   enough. At every instant of either run, each photo is readable at the old
 *   path, the new one, or both — never neither.
 * - **Loud, not fatal, about gaps.** A photo whose files are already gone (a
 *   row left behind by a wiped upload directory) is reported and counted, not
 *   thrown on: one such row must not stop the other thousand from moving. The
 *   process still exits non-zero, so a scripted run cannot mistake it for a
 *   clean migration.
 */
import { copyFile, mkdir, rename, rmdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { db } from '../src/lib/db'
import { photoDir, photoFilename, uploadDir } from '../src/lib/images'
import { WIDTHS } from '../src/lib/photo-url'

/** What the file was called under the old layout, where the item owned the directory. */
function oldFilename(photoId: string, width: number): string {
  return `${photoId}-${width}.webp`
}

type PhotoOutcome = {
  /** Copied into the new layout by this run. */
  copied: number
  /** Already where this pass wanted it — copied by an earlier run, or already removed. */
  already: number
  /** Original removed by this run (cleanup only). */
  removed: number
  /** Cleanup found an original whose copy is not in place, and left it alone. */
  uncopied: number
  /** Neither layout has this width at all. */
  missing: number
}

const noOutcome = (): PhotoOutcome => ({ copied: 0, already: 0, removed: 0, uncopied: 0, missing: 0 })

/**
 * Copies one file into place without ever letting a partial copy hold the
 * destination name: write `<dest>.tmp`, check it, then rename. Rename is
 * atomic within a filesystem, so a reader sees the old file or the whole new
 * one. A failure removes the temporary and rethrows.
 */
async function copyIntoPlace(source: string, dest: string, expectedSize: number): Promise<void> {
  const tmp = `${dest}.tmp`
  try {
    await copyFile(source, tmp)
    const tmpStat = await stat(tmp)
    if (tmpStat.size !== expectedSize) {
      throw new Error(`copied ${source} to ${tmp} but got ${tmpStat.size} of ${expectedSize} bytes`)
    }
    await rename(tmp, dest)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

async function migratePhoto(photoId: string, itemId: string, cleanup: boolean): Promise<PhotoOutcome> {
  const sourceDir = path.join(uploadDir(), itemId)
  const destDir = photoDir(photoId)
  const outcome = noOutcome()

  for (const width of WIDTHS) {
    const dest = path.join(destDir, photoFilename(width))
    const source = path.join(sourceDir, oldFilename(photoId, width))

    const [destStat, sourceStat] = await Promise.all([
      stat(dest).catch(() => null),
      stat(source).catch(() => null),
    ])

    if (!sourceStat) {
      // Nothing left in the old layout. A destination means this width is done
      // — which is what makes either pass a no-op the second time; no
      // destination means the files are simply gone, and the caller reports it.
      if (destStat) outcome.already += 1
      else outcome.missing += 1
      continue
    }

    // The one test that licenses a delete, and the same one that lets a copy be
    // skipped: the destination is there and is the size of the original it came
    // from. "It exists" alone would bless a file truncated by a run that died
    // mid-copy.
    const copyInPlace = destStat !== null && destStat.size === sourceStat.size

    if (cleanup) {
      if (!copyInPlace) {
        // Refused, not repaired. Pass 2's whole job is deleting, and a pass 2
        // that quietly did pass 1's work would be removing originals on the
        // strength of a copy no running build has served yet.
        outcome.uncopied += 1
        continue
      }
      await unlink(source)
      outcome.removed += 1
      continue
    }

    if (copyInPlace) {
      outcome.already += 1
      continue
    }

    // Either there is no destination, or one that does not match the original
    // it was supposedly copied from — a truncated file from a run that died
    // mid-copy. The original is authoritative either way, so write it over.
    await mkdir(destDir, { recursive: true })
    await copyIntoPlace(source, dest, sourceStat.size)
    outcome.copied += 1
  }

  return outcome
}

/**
 * Only ever removes a directory that is already empty; rmdir refuses a
 * non-empty one, and anything it refuses is left exactly as it was. Cleanup
 * only — after pass 1 every one of these still holds the originals.
 */
async function removeEmptyItemDirs(itemIds: Set<string>): Promise<number> {
  let emptied = 0
  for (const itemId of itemIds) {
    if (await rmdir(path.join(uploadDir(), itemId)).then(() => true, () => false)) emptied += 1
  }
  return emptied
}

async function main() {
  const cleanup = process.argv.includes('--cleanup')
  const photos = await db.photo.findMany({ select: { id: true, itemId: true }, orderBy: { id: 'asc' } })

  let copiedFiles = 0
  let alreadyFiles = 0
  let removedFiles = 0
  let intact = 0
  const untouched: string[] = []
  const incomplete: string[] = []
  const uncopied: string[] = []
  const itemDirs = new Set<string>()

  for (const photo of photos) {
    // Task 2 makes itemId nullable; such a photo was never stored under an
    // item and so has nothing to move.
    if (!photo.itemId) continue
    itemDirs.add(photo.itemId)

    const outcome = await migratePhoto(photo.id, photo.itemId, cleanup)
    copiedFiles += outcome.copied
    alreadyFiles += outcome.already
    removedFiles += outcome.removed

    if (outcome.uncopied > 0) uncopied.push(photo.id)
    if (outcome.missing === WIDTHS.length) untouched.push(photo.id)
    else if (outcome.missing > 0) incomplete.push(photo.id)
    else intact += 1
  }

  const emptied = cleanup ? await removeEmptyItemDirs(itemDirs) : 0

  console.log(`upload dir: ${uploadDir()}`)
  console.log(`pass: ${cleanup ? 'cleanup — removing originals' : 'copy — removing nothing'}`)
  console.log(`photos in the database: ${photos.length}`)
  console.log(`  photos with every width on disk: ${intact}`)
  if (cleanup) {
    console.log(`  originals removed this run: ${removedFiles}`)
    console.log(`  originals already gone: ${alreadyFiles}`)
    console.log(`  old item directories removed: ${emptied}`)
  } else {
    console.log(`  files copied this run: ${copiedFiles}`)
    console.log(`  files already copied: ${alreadyFiles}`)
  }

  if (uncopied.length > 0) {
    console.warn(`\n${uncopied.length} photo(s) still had originals with no copy in place, and were left alone:`)
    for (const id of uncopied) console.warn(`  ${id}`)
    console.warn('run the copy pass (npm run migrate:photos) and then this one again.')
  }
  if (incomplete.length > 0) {
    console.warn(`\n${incomplete.length} photo(s) are missing some widths on disk:`)
    for (const id of incomplete) console.warn(`  ${id}`)
  }
  if (untouched.length > 0) {
    console.warn(`\n${untouched.length} photo(s) have no files at all, in either layout:`)
    for (const id of untouched) console.warn(`  ${id}`)
  }

  if (uncopied.length === 0 && incomplete.length === 0 && untouched.length === 0) {
    if (cleanup) console.log('\nevery photo row has all its widths, in the new layout alone.')
    else {
      console.log('\nevery photo row has all its widths, in both layouts.')
      console.log('deploy, check that photos render, then reclaim the space:')
      console.log('  npm run migrate:photos -- --cleanup')
    }
    return
  }

  // A production run is scripted, and a summary scrolling past in a log is not
  // a review. Exit non-zero so a photo with no files stops the deploy step
  // that called this instead of reading as a clean migration.
  console.warn('\nfinished with gaps — see above.')
  process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
