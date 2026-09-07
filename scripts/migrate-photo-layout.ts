/**
 * One-shot: move every photo's files from the old item-keyed layout to the
 * photo-keyed one.
 *
 *   <UPLOAD_DIR>/<itemId>/<photoId>-<width>.webp  →  <UPLOAD_DIR>/<photoId>/<width>.webp
 *
 *   npx tsx scripts/migrate-photo-layout.ts
 *
 * Three properties, all load-bearing:
 *
 * - **Idempotent, and it finishes what it started.** A width is copied to
 *   `<width>.webp.tmp` and then renamed into place, and rename is atomic within
 *   one filesystem — so `<width>.webp` either does not exist or is a complete
 *   file, never a half-written one. "Destination exists" alone is not enough to
 *   call a width done: while the source is still there the two are compared,
 *   and a destination that does not match its source is rewritten from it.
 *   That is what makes an interrupted run actually finish on the next one
 *   rather than blessing whatever it finds. (A stray `.tmp` from a killed run
 *   is overwritten by the next copy, and the serving route's filename regex
 *   never matches it, so one can never be served.)
 * - **Never destructive.** A source is unlinked only once the destination is in
 *   place with the same byte length. At every instant of the run each photo is
 *   readable at the old path, the new one, or both — never neither.
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

type PhotoOutcome = { moved: number; already: number; missing: number }

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

async function migratePhoto(photoId: string, itemId: string): Promise<PhotoOutcome> {
  const sourceDir = path.join(uploadDir(), itemId)
  const destDir = photoDir(photoId)
  const outcome: PhotoOutcome = { moved: 0, already: 0, missing: 0 }

  for (const width of WIDTHS) {
    const dest = path.join(destDir, photoFilename(width))
    const source = path.join(sourceDir, oldFilename(photoId, width))

    const [destStat, sourceStat] = await Promise.all([
      stat(dest).catch(() => null),
      stat(source).catch(() => null),
    ])

    if (!sourceStat) {
      // Nothing left to move. A destination means this width is already
      // migrated — which is what makes a second run a no-op; no destination
      // means the files are simply gone, and the caller reports that.
      if (destStat) outcome.already += 1
      else outcome.missing += 1
      continue
    }

    if (destStat && destStat.size === sourceStat.size) {
      // The copy landed but the source outlived it — a run killed between the
      // rename and the unlink. Finish that job rather than redo it.
      await unlink(source)
      outcome.already += 1
      continue
    }

    // Either there is no destination, or there is one that does not match the
    // source it was supposedly copied from — a truncated file from a run that
    // died mid-copy under an older version of this script. The source is
    // authoritative either way, so write it over the top.
    await mkdir(destDir, { recursive: true })
    await copyIntoPlace(source, dest, sourceStat.size)
    await unlink(source)
    outcome.moved += 1
  }

  return outcome
}

async function main() {
  const photos = await db.photo.findMany({ select: { id: true, itemId: true }, orderBy: { id: 'asc' } })

  let movedFiles = 0
  let alreadyFiles = 0
  const fullyMigrated: string[] = []
  const untouched: string[] = []
  const incomplete: string[] = []
  const itemDirs = new Set<string>()

  for (const photo of photos) {
    // Task 2 makes itemId nullable; such a photo was never stored under an
    // item and so has nothing to move.
    if (!photo.itemId) continue
    itemDirs.add(photo.itemId)

    const outcome = await migratePhoto(photo.id, photo.itemId)
    movedFiles += outcome.moved
    alreadyFiles += outcome.already

    if (outcome.missing === WIDTHS.length) untouched.push(photo.id)
    else if (outcome.missing > 0) incomplete.push(photo.id)
    else fullyMigrated.push(photo.id)
  }

  // Only ever removes a directory that is already empty; rmdir refuses a
  // non-empty one, and anything it refuses is left exactly as it was.
  let emptied = 0
  for (const itemId of itemDirs) {
    if (await rmdir(path.join(uploadDir(), itemId)).then(() => true, () => false)) emptied += 1
  }

  console.log(`upload dir: ${uploadDir()}`)
  console.log(`photos in the database: ${photos.length}`)
  console.log(`  complete in the new layout: ${fullyMigrated.length}`)
  console.log(`  files moved this run: ${movedFiles}`)
  console.log(`  files already in place: ${alreadyFiles}`)
  console.log(`  old item directories removed: ${emptied}`)

  if (incomplete.length > 0) {
    console.warn(`\n${incomplete.length} photo(s) are missing some widths on disk:`)
    for (const id of incomplete) console.warn(`  ${id}`)
  }
  if (untouched.length > 0) {
    console.warn(`\n${untouched.length} photo(s) have no files at all, in either layout:`)
    for (const id of untouched) console.warn(`  ${id}`)
  }
  if (incomplete.length === 0 && untouched.length === 0) {
    console.log('\nevery photo row has all its widths.')
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
