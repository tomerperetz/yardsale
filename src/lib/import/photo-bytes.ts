import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { photoDir, photoFilename } from '@/lib/images'

/**
 * The stored width every model call is shown, and how it is read off disk.
 *
 * Its own module because three callers want it now — the import's two passes
 * and the rewrite of existing descriptions — and because `MODEL_WIDTH` is the
 * kind of constant that goes wrong quietly: shown at one width and read back
 * at another, every call would simply find no file and degrade.
 */

/** The smallest width stored, and plenty to recognise an object by. */
export const MODEL_WIDTH = 400

/**
 * The bytes a model call shows, by photo id. A photo whose file cannot be read
 * is simply absent — it is not shown to the model, and on the import path
 * `accountForEveryPhoto` still gives it an item, because a missing file is no
 * reason for a row to end up on nothing.
 */
export async function readPhotoBytes(ids: string[]): Promise<Map<string, Buffer>> {
  const bytes = new Map<string, Buffer>()
  const unreadable: string[] = []

  await Promise.all(
    ids.map(async (id) => {
      try {
        bytes.set(id, await readFile(path.join(photoDir(id), photoFilename(MODEL_WIDTH))))
      } catch (err) {
        unreadable.push(`${id} (${err instanceof Error ? err.message : String(err)})`)
      }
    }),
  )

  // One line for the batch rather than one per photo: a misconfigured
  // UPLOAD_DIR makes every photo unreadable at once, and sixty stack traces
  // would bury the rest of the import's logging.
  if (unreadable.length > 0) {
    console.error(`[import] no readable ${MODEL_WIDTH}px file for ${unreadable.length} photo(s):`, unreadable.join('; '))
  }

  return bytes
}
