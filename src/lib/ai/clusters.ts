/**
 * Turns a model's grouping of photo indices into groups of photo ids, and
 * guarantees the accounting: every photo lands in exactly one group.
 *
 * A model can repeat an index, invent one, or quietly omit one, and none of
 * those may cost the seller a photo or duplicate it across two products.
 * Returns null only when the shape itself is wrong, which is the caller's
 * signal to fall back to capture-time grouping. Spec §8 is the contract.
 *
 * Where a value is ambiguous the answer is null, never a guess: a rejection
 * costs one fallback to capture-time grouping, while a wrong guess puts one
 * photo on two products or drops it from the shop with nothing to notice it.
 *
 * - `null`, `undefined` or anything else in place of a group: rejected. The
 *   response is not the shape it claims to be, and skipping the entry would
 *   accept a broken response as if part of it were trustworthy.
 * - `"2"`, `true`, `1.5`, `NaN`, `±Infinity` as an index: rejected. Coercing a
 *   numeric string guesses at intent, and `NaN`/`Infinity` fail the range test
 *   below without ever being integers, so they would vanish unremarked.
 * - `-0`: photo 0, and nothing else. `Number.isInteger(-0)` holds, `-0 < 0` is
 *   false, `photoIds[-0]` reads index 0, and `Set` stores it as 0 — so it can
 *   neither address a different photo nor slip a duplicate past `seen`.
 * - a negative or huge index, and an index repeated inside a single group: the
 *   index is dropped, and any photo left unplaced is appended as its own group.
 * - a group that is empty, or whose indices were all dropped: not emitted, so
 *   no empty draft reaches the review screen.
 * - an empty batch: `[]`. Zero photos is a grouping, not a failure.
 */
export function normalizeClusters(raw: unknown, photoIds: string[]): string[][] | null {
  // Accounting is by index, so two equal ids would each sit in exactly one
  // group by index while the same photo appeared on two products — the very
  // failure this function exists to prevent, and invisible from the output.
  // Ids are database keys and cannot repeat; if they ever do, refuse.
  if (new Set(photoIds).size !== photoIds.length) return null

  if (!Array.isArray(raw)) return null
  const groups: string[][] = []
  const seen = new Set<number>()

  for (const group of raw) {
    if (!Array.isArray(group)) return null
    const out: string[] = []
    for (const index of group) {
      if (typeof index !== 'number' || !Number.isInteger(index)) return null
      if (index < 0 || index >= photoIds.length) continue
      if (seen.has(index)) continue
      seen.add(index)
      out.push(photoIds[index])
    }
    if (out.length > 0) groups.push(out)
  }

  photoIds.forEach((id, index) => {
    if (!seen.has(index)) groups.push([id])
  })

  return groups
}
