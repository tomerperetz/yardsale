// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { IMPORT_CHUNK_FILES } from '@/lib/photo-url'

/**
 * The drop step of the AI import (spec §7.1) — specifically the shape of the
 * requests it makes, which is the half `e2e/import.spec.ts` cannot see.
 *
 * The e2e drives the server: it proves that six-photo chunks arriving one
 * after another are numbered 0..n-1 across the whole batch. But it posts those
 * chunks itself, so it would stay green if this component started posting them
 * all at once — the very thing that breaks the numbering. What is asserted
 * here is the client's side of that guarantee: one request in flight at a
 * time, each carrying the batch id the last one answered with.
 *
 * Everything the browser does not do under jsdom is mocked at the seam this
 * component imports it from: EXIF, the HEIC conversion, the server action, the
 * router, and `fetch` itself.
 */

const readTakenAt = vi.fn()
vi.mock('@/lib/exif-client', () => ({ readTakenAt: (...args: unknown[]) => readTakenAt(...args) }))

// Identity: the conversion is a canvas round-trip, which jsdom has no pixels
// for, and nothing here depends on it happening.
vi.mock('@/lib/heic-client', () => ({ convertHeicIfNeeded: (file: File) => Promise.resolve(file) }))

const clusterBatchAction = vi.fn()
vi.mock('@/app/admin/items/import/actions', () => ({
  clusterBatchAction: (...args: unknown[]) => clusterBatchAction(...args),
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import { ImportDrop } from '@/app/admin/items/import/ImportDrop'

/** One request as it reached `fetch`, in the order they were made. */
type Seen = { batchId: string | null; files: number; takenAt: string[] }

let seen: Seen[]
let inFlight: number
let peakInFlight: number

function stubFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    inFlight += 1
    peakInFlight = Math.max(peakInFlight, inFlight)

    const form = init.body as FormData
    const batchId = form.get('batchId')
    const files = form.getAll('files')
    seen.push({
      batchId: typeof batchId === 'string' ? batchId : null,
      files: files.length,
      takenAt: form.getAll('takenAt').map(String),
    })

    // Yields to the event loop while this request is "open". A component that
    // fired its chunks together would enter here again before this line
    // returns, and peakInFlight would be 2.
    await new Promise((resolve) => setTimeout(resolve, 0))
    inFlight -= 1

    const minted = typeof batchId === 'string' ? batchId : 'batch-1'
    return {
      ok: true,
      json: async () => ({
        batchId: minted,
        photos: files.map((_, i) => ({ id: `${minted}-${seen.length}-${i}` })),
        errors: [],
      }),
    } as unknown as Response
  })
}

function jpegs(count: number): File[] {
  return Array.from(
    { length: count },
    (_, i) => new File([`photo-${i}`], `photo-${i}.jpg`, { type: 'image/jpeg', lastModified: 1_760_000_000_000 }),
  )
}

function dropFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('the drop zone has no file input')
  fireEvent.change(input, { target: { files } })
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  seen = []
  inFlight = 0
  peakInFlight = 0
  readTakenAt.mockResolvedValue(new Date('2026-09-03T09:00:00.000Z'))
  clusterBatchAction.mockResolvedValue({ ok: true, itemIds: ['i1'], notice: 'NONE' })
  vi.stubGlobal('fetch', stubFetch())
})

describe('the import drop zone', () => {
  it('posts six photos per request, one request at a time', async () => {
    const { container } = render(<ImportDrop />)

    dropFiles(container, jpegs(9))

    await waitFor(() => expect(clusterBatchAction).toHaveBeenCalled())

    expect(seen.map((request) => request.files)).toEqual([IMPORT_CHUNK_FILES, 9 - IMPORT_CHUNK_FILES])
    // The assertion this file exists for. Two chunks posted together would
    // both read the same photo count on the server and collide on position —
    // nothing lost, but the batch's order, and so every item's cover photo,
    // scrambled (spec §7.1).
    expect(peakInFlight).toBe(1)
  })

  it('threads the batch id from the first response through every request after it', async () => {
    const { container } = render(<ImportDrop />)

    dropFiles(container, jpegs(9))

    await waitFor(() => expect(clusterBatchAction).toHaveBeenCalled())

    // The first request mints the batch; the rest join it. This threading is
    // also what makes the sequencing above structural rather than incidental:
    // request two cannot be built until request one has answered.
    expect(seen[0].batchId).toBe(null)
    expect(seen[1].batchId).toBe('batch-1')
    expect(clusterBatchAction).toHaveBeenCalledWith('batch-1')
    expect(push).toHaveBeenCalledWith('/admin/items/import/batch-1')
  })

  it('sends a takenAt for every file, so the fallback grouping has something to group by', async () => {
    const { container } = render(<ImportDrop />)

    dropFiles(container, jpegs(9))

    await waitFor(() => expect(clusterBatchAction).toHaveBeenCalled())

    // Positionally paired with `files` — the route reads the two lists by
    // index. A capture time not recorded at intake cannot be recovered later,
    // and it is what clusterBatch groups by when no model call is made.
    for (const request of seen) {
      expect(request.takenAt).toHaveLength(request.files)
      expect(request.takenAt.every((value) => value === '2026-09-03T09:00:00.000Z')).toBe(true)
    }
  })

  it('carries the notice into the review screen URL, so a reload still shows it', async () => {
    clusterBatchAction.mockResolvedValue({ ok: true, itemIds: ['i1'], notice: 'OUT_OF_CREDIT' })
    const { container } = render(<ImportDrop />)

    dropFiles(container, jpegs(2))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/items/import/batch-1?notice=OUT_OF_CREDIT'))
  })
})
