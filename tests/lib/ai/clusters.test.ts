import { describe, it, expect } from 'vitest'
import { normalizeClusters } from '@/lib/ai/clusters'

const ids = ['a', 'b', 'c', 'd']

/**
 * The one invariant the caller depends on (spec §8): either the response was
 * refused, or every photo in the batch appears in exactly one non-empty group.
 */
const accountsForEveryPhoto = (result: string[][] | null, photoIds: string[]): boolean => {
  if (result === null) return true
  if (result.some((group) => group.length === 0)) return false
  const flat = result.flat()
  return (
    flat.length === photoIds.length &&
    new Set(flat).size === photoIds.length &&
    photoIds.every((id) => flat.includes(id))
  )
}

/** Every array of length 0..maxLength drawn from `alphabet`, in a fixed order. */
const arraysUpTo = <T>(alphabet: T[], maxLength: number): T[][] => {
  let all: T[][] = [[]]
  let level: T[][] = [[]]
  for (let n = 0; n < maxLength; n++) {
    level = level.flatMap((prefix) => alphabet.map((value) => [...prefix, value]))
    all = all.concat(level)
  }
  return all
}

/** Deterministic PRNG — a fuzz that fails must fail again on the next run. */
const lcg = (seed: number) => {
  let state = seed >>> 0
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32
}

describe('normalizeClusters', () => {
  it('maps the model indices onto the batch photo ids', () => {
    expect(normalizeClusters([[0, 1], [2, 3]], ids)).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('keeps a photo the model listed in two groups on one product only', () => {
    expect(normalizeClusters([[0, 1], [1, 2], [3]], ids)).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('discards an index outside the batch instead of reaching past the end of the ids', () => {
    expect(normalizeClusters([[0, 99], [1, 2, 3]], ids)).toEqual([['a'], ['b', 'c', 'd']])
  })

  it('gives a photo the model forgot its own group rather than losing it from the shop', () => {
    expect(normalizeClusters([[0, 1]], ids)).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('drops a group whose indices all failed, so no empty draft reaches review', () => {
    expect(normalizeClusters([[0], [99], [1, 2, 3]], ids)).toEqual([['a'], ['b', 'c', 'd']])
  })

  it('refuses a response that is not an array of arrays of integers, rather than half-reading it', () => {
    expect(normalizeClusters('nope', ids)).toBeNull()
    expect(normalizeClusters([1, 2], ids)).toBeNull()
    expect(normalizeClusters([['a']], ids)).toBeNull()
    expect(normalizeClusters([[1.5]], ids)).toBeNull()
    expect(normalizeClusters(null, ids)).toBeNull()
    expect(normalizeClusters(undefined, ids)).toBeNull()
    expect(normalizeClusters({ groups: [[0, 1]] }, ids)).toBeNull()
    expect(normalizeClusters([[true]], ids)).toBeNull()
    expect(normalizeClusters([[[0]]], ids)).toBeNull()
  })

  it('gives every photo its own draft when the model returns no groups at all', () => {
    expect(normalizeClusters([], ids)).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  it('preserves the model ordering, so the review screen matches the grouping it explained', () => {
    expect(normalizeClusters([[3, 1], [2]], ids)).toEqual([['d', 'b'], ['c'], ['a']])
  })

  // --- Adversarial cases beyond the plan's list -------------------------------

  it('refuses a null or missing group instead of treating it as a group the model skipped', () => {
    expect(normalizeClusters([[0, 1], null, [2, 3]], ids)).toBeNull()
    expect(normalizeClusters([[0, 1], undefined], ids)).toBeNull()
    // A sparse array — a hole reads as undefined and must be refused the same way.
    expect(normalizeClusters([, [0, 1]], ids)).toBeNull()
    expect(normalizeClusters([[0, null]], ids)).toBeNull()
    expect(normalizeClusters([[0, undefined]], ids)).toBeNull()
  })

  it('drops an empty group without letting its absence cost a photo', () => {
    expect(normalizeClusters([[], [0, 1]], ids)).toEqual([['a', 'b'], ['c'], ['d']])
    expect(normalizeClusters([[], [], []], ids)).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  it('returns no groups for an empty batch rather than failing the import over it', () => {
    expect(normalizeClusters([], [])).toEqual([])
    expect(normalizeClusters([[0]], [])).toEqual([])
    expect(normalizeClusters([[]], [])).toEqual([])
  })

  it('treats -0 as photo 0, so it can neither address another photo nor duplicate one', () => {
    expect(normalizeClusters([[-0, 1], [2, 3]], ids)).toEqual([['a', 'b'], ['c', 'd']])
    expect(normalizeClusters([[0], [-0, 1]], ids)).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  it('refuses NaN and Infinity, which a bare range check would silently swallow', () => {
    expect(normalizeClusters([[NaN]], ids)).toBeNull()
    expect(normalizeClusters([[0, NaN], [1, 2, 3]], ids)).toBeNull()
    expect(normalizeClusters([[Infinity]], ids)).toBeNull()
    expect(normalizeClusters([[-Infinity]], ids)).toBeNull()
  })

  it('refuses a stringified index rather than guessing which photo "2" meant', () => {
    expect(normalizeClusters([['2']], ids)).toBeNull()
    expect(normalizeClusters([['0', '1'], ['2', '3']], ids)).toBeNull()
    expect(normalizeClusters([[0, '1']], ids)).toBeNull()
  })

  it('attaches a photo the model repeated inside one group to that product once', () => {
    expect(normalizeClusters([[0, 0, 1], [2, 3]], ids)).toEqual([['a', 'b'], ['c', 'd']])
    expect(normalizeClusters([[0, 0]], ids)).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  it('drops negative and out-of-reach indices and still accounts for the photos they missed', () => {
    expect(normalizeClusters([[0, -1, 1e6, Number.MAX_SAFE_INTEGER], [1]], ids)).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['d'],
    ])
    expect(normalizeClusters([[-1, -2]], ids)).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  it('refuses a batch with duplicate ids, where index accounting cannot stop one photo reaching two products', () => {
    expect(normalizeClusters([[0], [1, 2]], ['a', 'a', 'b'])).toBeNull()
    expect(normalizeClusters([], ['a', 'a'])).toBeNull()
  })

  it('leaves the caller arrays untouched, since the caller reuses them for the fallback', () => {
    const photoIds = ['a', 'b', 'c']
    const raw = [[0, 1]]
    normalizeClusters(raw, photoIds)
    expect(photoIds).toEqual(['a', 'b', 'c'])
    expect(raw).toEqual([[0, 1]])
  })

  it('accounts for every photo exactly once across every grouping of a three-photo batch', () => {
    const groups = arraysUpTo([-1, 0, 1, 2, 3], 2)
    const raws = arraysUpTo(groups, 2)
    const three = ['a', 'b', 'c']
    const broken = raws.filter((raw) => !accountsForEveryPhoto(normalizeClusters(raw, three), three))
    expect({ cases: raws.length, broken }).toEqual({ cases: 993, broken: [] })
  })

  it('never throws and never mis-accounts on junk the model might emit', () => {
    const junk: unknown[] = [
      0, 1, 2, 3, -1, -0, 1.5, NaN, Infinity, -Infinity, 1e21, Number.MAX_SAFE_INTEGER,
      '0', '2', 'a', null, undefined, true, false, {}, [0], [[1]],
    ]
    const next = lcg(20260907)
    const pick = <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)]

    for (let n = 0; n < 2000; n++) {
      const raw =
        next() < 0.05
          ? pick(junk)
          : Array.from({ length: Math.floor(next() * 4) }, () =>
              next() < 0.1 ? pick(junk) : Array.from({ length: Math.floor(next() * 4) }, () => pick(junk)),
            )
      const result = normalizeClusters(raw, ids)
      expect({ raw, ok: accountsForEveryPhoto(result, ids) }).toEqual({ raw, ok: true })
    }
  })
})
