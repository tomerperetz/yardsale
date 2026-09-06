export type PickupWindow = { id: string; from: Date; to: Date }

export type Intersection =
  | { ok: true; from: Date; to: Date; startItemId: string; endItemId: string }
  | { ok: false; startItemId: string; endItemId: string }

const DAY_MS = 86_400_000

/** Calendar dates are compared as UTC midnight so local timezone never shifts a day. */
export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function intersectPickupWindows(windows: PickupWindow[], today: Date): Intersection {
  if (windows.length === 0) return { ok: false, startItemId: '', endItemId: '' }

  const floor = startOfUtcDay(today)

  let start = windows[0]
  let end = windows[0]
  for (const w of windows) {
    if (w.from.getTime() > start.from.getTime()) start = w
    if (w.to.getTime() < end.to.getTime()) end = w
  }

  const from = new Date(Math.max(start.from.getTime(), floor.getTime()))
  const to = end.to

  if (from.getTime() > to.getTime()) {
    return { ok: false, startItemId: start.id, endItemId: end.id }
  }
  return { ok: true, from, to, startItemId: start.id, endItemId: end.id }
}

export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = []
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) days.push(new Date(t))
  return days
}
