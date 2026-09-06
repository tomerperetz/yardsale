export type PhotoStamp = { key: string; takenAt: Date | null; lastModified: number | null }

const DEFAULT_GAP_SECONDS = 30

function stampOf(p: PhotoStamp): number | null {
  if (p.takenAt) return p.takenAt.getTime()
  if (p.lastModified !== null) return p.lastModified
  return null
}

/**
 * Groups a bulk drop into draft items: consecutive photos taken within `gapSeconds`
 * of each other are assumed to be the same object. Only ever a proposal — the queue
 * lets the seller split or merge before anything is written.
 */
export function groupByCaptureTime(photos: PhotoStamp[], gapSeconds: number = DEFAULT_GAP_SECONDS): string[][] {
  const gapMs = gapSeconds * 1000

  const stamped = photos
    .map((p) => ({ key: p.key, t: stampOf(p) }))
    .filter((p): p is { key: string; t: number } => p.t !== null)
    .sort((a, b) => a.t - b.t)

  const groups: string[][] = []
  let prevT: number | null = null

  for (const p of stamped) {
    if (prevT !== null && p.t - prevT <= gapMs) {
      groups.at(-1)!.push(p.key)
    } else {
      groups.push([p.key])
    }
    prevT = p.t
  }

  for (const p of photos) {
    if (stampOf(p) === null) groups.push([p.key])
  }

  return groups
}
