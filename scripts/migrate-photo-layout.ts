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
 * - **Idempotent.** A width already present at its destination is counted and
 *   left alone, so a second run is a no-op and an interrupted run finishes on
 *   the next one.
 * - **Never destructive.** A source file is removed only after its destination
 *   exists with the same byte length. At every instant of the run each photo
 *   is readable at the old path, the new one, or both — never neither.
 * - **Loud, not fatal, about gaps.** A photo whose files are already gone (a
 *   row left behind by a wiped upload directory) is reported and counted, not
 *   thrown on: one such row must not stop the other thousand from moving.
 */
import { copyFile, mkdir, rmdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { db } from '../src/lib/db'
import { photoDir, photoFilename, uploadDir } from '../src/lib/images'
import { WIDTHS } from '../src/lib/photo-url'

/** What the file was called under the old layout, where the item owned the directory. */
function oldFilename(photoId: string, width: number): string {
  return `${photoId}-${width}.webp`
}

type PhotoOutcome = { moved: number; already: number; missing: number }

async function migratePhoto(photoId: string, itemId: string): Promise<PhotoOutcome> {
  const sourceDir = path.join(uploadDir(), itemId)
  const destDir = photoDir(photoId)
  const outcome: PhotoOutcome = { moved: 0, already: 0, missing: 0 }

  for (const width of WIDTHS) {
    const dest = path.join(destDir, photoFilename(width))
    const source = path.join(sourceDir, oldFilename(photoId, width))

    // Already migrated — this is what makes a re-run a no-op.
    if (await stat(dest).then(() => true, () => false)) {
      outcome.already += 1
      continue
    }

    const sourceStat = await stat(source).catch(() => null)
    if (!sourceStat) {
      outcome.missing += 1
      continue
    }

    await mkdir(destDir, { recursive: true })
    await copyFile(source, dest)

    // Verify before unlinking: a truncated copy that replaced its source
    // would be a silently broken photo in the shop.
    const destStat = await stat(dest)
    if (destStat.size !== sourceStat.size) {
      throw new Error(`${dest} is ${destStat.size} bytes but ${source} is ${sourceStat.size} — refusing to remove the source`)
    }

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
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
