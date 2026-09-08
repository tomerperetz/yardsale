// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The review screen (spec §7.3). Both action modules are mocked: they carry
 * 'use server' and pull Prisma, which cannot run under jsdom, and what is
 * worth asserting here is what the screen ASKS them to do — that a pickup
 * window goes whole, that publishing writes what the seller is looking at,
 * and that nothing user-facing is in English.
 */
const bulkEdit = vi.fn()
const clusterBatchAction = vi.fn()
const discardBatch = vi.fn()
const discardItems = vi.fn()
const movePhoto = vi.fn()
const publishItems = vi.fn()
const removePhoto = vi.fn()
vi.mock('@/app/admin/items/import/actions', () => ({
  bulkEdit: (...args: unknown[]) => bulkEdit(...args),
  clusterBatchAction: (...args: unknown[]) => clusterBatchAction(...args),
  discardBatch: (...args: unknown[]) => discardBatch(...args),
  discardItems: (...args: unknown[]) => discardItems(...args),
  movePhoto: (...args: unknown[]) => movePhoto(...args),
  publishItems: (...args: unknown[]) => publishItems(...args),
  removePhoto: (...args: unknown[]) => removePhoto(...args),
}))

const updateItemAction = vi.fn()
vi.mock('@/app/admin/items/actions', () => ({
  updateItemAction: (...args: unknown[]) => updateItemAction(...args),
}))

import { ImportReview, type ReviewItem } from '@/app/admin/items/import/[batchId]/ImportReview'

const DEFAULTS = { categoryName: 'ריהוט', pickupFrom: '2026-09-12', pickupTo: '2026-09-18' }

function items(): ReviewItem[] {
  return [
    {
      id: 'i1',
      name: 'ספה תלת־מושבית',
      description: 'בד אפור.',
      price: '850',
      categoryName: 'ריהוט',
      pickupFrom: '2026-09-12',
      pickupTo: '2026-09-18',
      photos: [
        { id: 'p1', lqip: 'data:,' },
        { id: 'p2', lqip: 'data:,' },
      ],
    },
    {
      id: 'i2',
      name: 'מנורת קריאה',
      description: '',
      price: '',
      categoryName: 'ריהוט',
      pickupFrom: '2026-09-12',
      pickupTo: '2026-09-18',
      photos: [{ id: 'p3', lqip: 'data:,' }],
    },
  ]
}

function renderReview(overrides: Partial<Parameters<typeof ImportReview>[0]> = {}) {
  return render(
    <ImportReview
      batchId="batch-1"
      items={items()}
      categories={['ריהוט', 'מטבח']}
      loosePhotos={[]}
      notice="NONE"
      defaults={DEFAULTS}
      {...overrides}
    />,
  )
}

// vitest.config.ts keeps `globals: false`, so Testing Library's automatic
// cleanup is not installed — without this every render stacks up in one
// document and each query finds the previous test's screen too.
afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  bulkEdit.mockResolvedValue({ ok: true })
  discardItems.mockResolvedValue({ ok: true, discarded: 2, refused: [] })
  discardBatch.mockResolvedValue({ ok: true, items: 2, photos: 3 })
  removePhoto.mockResolvedValue({ ok: true })
  updateItemAction.mockResolvedValue({ ok: true, id: 'i2', slug: 'x' })
  publishItems.mockResolvedValue({ ok: true, published: 0, refused: [] })
})

describe('the import review screen', () => {
  it('shows one card per proposed item, with its photos and its fields', () => {
    renderReview()

    expect(screen.getByLabelText('פריט 1')).toBeTruthy()
    expect(screen.getByLabelText('פריט 2')).toBeTruthy()
    expect(screen.getByDisplayValue('ספה תלת־מושבית')).toBeTruthy()
    expect(screen.getByDisplayValue('בד אפור.')).toBeTruthy()
    // Singular is spelled out: "1 תמונות" is wrong Hebrew.
    expect(screen.getByText('תמונה אחת')).toBeTruthy()
    expect(screen.getByText('2 תמונות')).toBeTruthy()
    expect(screen.getAllByAltText('').map((img) => img.getAttribute('src'))).toEqual([
      '/img/p1/400.webp',
      '/img/p2/400.webp',
      '/img/p3/400.webp',
    ])
  })

  it('keeps the pickup window direction-isolated, so 12–18 is not read as 18–12', () => {
    const { container } = renderReview()
    const isolate = container.querySelector('span[dir="ltr"]')
    expect(isolate?.textContent).toBe('12–18')
  })

  it('says in Hebrew that the AI account has no credit and that everything else still works', () => {
    const { container } = renderReview({ notice: 'OUT_OF_CREDIT' })

    expect(screen.getByText(/אין יתרה בחשבון/)).toBeTruthy()
    expect(screen.getByText(/כל השאר עובד כרגיל/)).toBeTruthy()
    // No stack trace, no English — anywhere on the screen.
    expect(container.textContent ?? '').not.toMatch(/[A-Za-z]/)
  })

  it('says copy was not generated when that is all that went wrong', () => {
    renderReview({ notice: 'NO_COPY' })
    expect(screen.getByText(/לא יצרנו שמות ותיאורים אוטומטיים לייבוא הזה/)).toBeTruthy()
    expect(screen.queryByText(/אין יתרה בחשבון/)).toBeNull()
  })

  it('sends both ends of a pickup window in one call, never one', async () => {
    renderReview()

    fireEvent.change(screen.getByLabelText('איסוף מתאריך לכל הנבחרים'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByText('החלת התאריכים'))

    await waitFor(() => expect(bulkEdit).toHaveBeenCalledTimes(1))
    expect(bulkEdit).toHaveBeenCalledWith(['i1', 'i2'], { pickupFrom: '2026-10-01', pickupTo: '2026-09-18' })
  })

  it('applies a price to the selection alone', async () => {
    renderReview()

    // Deselect the second card, so the patch must reach the first only.
    fireEvent.click(screen.getByLabelText('פריט 2'))
    fireEvent.change(screen.getByLabelText('מחיר לכולם'), { target: { value: '120' } })
    fireEvent.click(screen.getByText('החלת המחיר'))

    await waitFor(() => expect(bulkEdit).toHaveBeenCalledWith(['i1'], { price: '120' }))
    expect(screen.getByText('הפריט עודכן.')).toBeTruthy()
  })

  it('moves a photo to another item of the batch', async () => {
    movePhoto.mockResolvedValue({ ok: true, itemId: 'i2' })
    renderReview()

    fireEvent.change(screen.getAllByLabelText('העברת התמונה לפריט')[0], { target: { value: 'i2' } })

    await waitFor(() => expect(movePhoto).toHaveBeenCalledWith('p1', 'i2'))
    await waitFor(() => expect(screen.getByText('2 תמונות')).toBeTruthy())
    expect(screen.getByText('תמונה אחת')).toBeTruthy()
  })

  it('moves a photo onto a brand new item and shows it as a card', async () => {
    movePhoto.mockResolvedValue({ ok: true, itemId: 'i3' })
    renderReview()

    fireEvent.change(screen.getAllByLabelText('העברת התמונה לפריט')[0], { target: { value: 'new' } })

    await waitFor(() => expect(movePhoto).toHaveBeenCalledWith('p1', 'new'))
    await waitFor(() => expect(screen.getByLabelText('פריט 3')).toBeTruthy())
  })

  it('removes one photo and leaves the rest of the item alone', async () => {
    renderReview()

    fireEvent.click(screen.getAllByLabelText('הסרת התמונה')[0])

    await waitFor(() => expect(removePhoto).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(screen.getAllByAltText('').length).toBe(2))
  })

  it('saves what the seller typed before publishing it, and keeps a refused item on the screen', async () => {
    // The real refusal an unpriced draft comes back with, since every imported
    // item is created at 0 agorot and this is the common one.
    publishItems.mockResolvedValue({
      ok: true,
      published: 1,
      refused: [{ id: 'i2', error: 'צריך לקבוע מחיר לפני הפרסום. פריט שניתן בחינם אפשר לפרסם מדף הפריט.' }],
    })
    renderReview()

    fireEvent.change(screen.getAllByLabelText('שם הפריט')[0], { target: { value: 'ספה אפורה' } })
    fireEvent.click(screen.getByText('פרסום'))

    // Only the edited card is written back before publishing — an untouched
    // one is already what the database holds.
    await waitFor(() => expect(updateItemAction).toHaveBeenCalledTimes(1))
    expect(updateItemAction).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({ name: 'ספה אפורה', publish: false }),
    )
    expect(publishItems).toHaveBeenCalledWith(['i1', 'i2'])

    await waitFor(() => expect(screen.getByText(/צריך לקבוע מחיר לפני הפרסום/)).toBeTruthy())
    expect(screen.getByText('פריט אחד פורסם.')).toBeTruthy()
    // The published one has left the review; the refused one has not.
    expect(screen.queryByDisplayValue('ספה אפורה')).toBeNull()
    expect(screen.getByDisplayValue('מנורת קריאה')).toBeTruthy()
  })

  it('does not publish an item whose own save was refused', async () => {
    updateItemAction.mockResolvedValue({ ok: false, error: 'צריך שם לפריט.' })
    renderReview()

    fireEvent.change(screen.getAllByLabelText('שם הפריט')[0], { target: { value: '' } })
    fireEvent.click(screen.getByText('פרסום'))

    await waitFor(() => expect(screen.getByText('צריך שם לפריט.')).toBeTruthy())
    expect(publishItems).toHaveBeenCalledWith(['i2'])
  })

  it('discards the selection only after it is confirmed', async () => {
    renderReview()

    fireEvent.click(screen.getByText('מחיקה'))
    expect(discardItems).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('כן, למחוק'))
    await waitFor(() => expect(discardItems).toHaveBeenCalledWith(['i1', 'i2']))
  })

  it('keeps a card the discard refused, and says why on it', async () => {
    // Another tab published this one while this screen went on rendering its
    // card. Removing it here because we asked would report נמחקו over an item
    // that is still on the shop.
    discardItems.mockResolvedValue({
      ok: true,
      discarded: 1,
      refused: [{ id: 'i1', error: 'הפריט כבר פורסם ואינו חלק מהייבוא. אפשר לטפל בו מרשימת הפריטים.' }],
    })
    renderReview()

    fireEvent.click(screen.getByText('מחיקה'))
    fireEvent.click(screen.getByText('כן, למחוק'))

    await waitFor(() =>
      expect(screen.getByText('הפריט כבר פורסם ואינו חלק מהייבוא. אפשר לטפל בו מרשימת הפריטים.')).toBeTruthy(),
    )
    expect(screen.getByText('חלק מהפריטים לא נמחקו. ההסבר מופיע על הכרטיס של כל אחד מהם.')).toBeTruthy()

    // The refused card is still here; the other one has gone.
    expect(screen.getByDisplayValue('ספה תלת־מושבית')).toBeTruthy()
    expect(screen.queryByDisplayValue('מנורת קריאה')).toBeNull()
  })

  it('discards the whole import, which is the only thing that reaches an unassigned photo', async () => {
    renderReview({ loosePhotos: [{ id: 'p9', lqip: 'data:,' }] })

    expect(screen.getByText('תמונה אחת עדיין לא שויכה לפריט.')).toBeTruthy()

    fireEvent.click(screen.getByText('מחיקת כל הייבוא'))
    expect(discardBatch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('כן, למחוק הכול'))
    await waitFor(() => expect(discardBatch).toHaveBeenCalledWith('batch-1'))
    // It says what went, rather than navigating away from the only report of
    // it: discardBatch keeps an item a live order is counting on.
    await waitFor(() => expect(screen.getByText('הייבוא נמחק: 2 פריטים, 3 תמונות.')).toBeTruthy())
    expect(screen.getByText('לרשימת הפריטים').getAttribute('href')).toBe('/admin/items')
  })

  it('stays usable when a server action throws instead of returning a refusal', async () => {
    removePhoto.mockRejectedValue(new Error('connection lost'))
    renderReview()

    fireEvent.click(screen.getAllByLabelText('הסרת התמונה')[0])

    await waitFor(() => expect(screen.getByText('הפעולה נכשלה. בדקו את החיבור ונסו שוב.')).toBeTruthy())
    // Not frozen: the screen's controls come back rather than staying disabled
    // behind a `busy` flag nothing will ever clear.
    const publish = screen.getByText('פרסום') as HTMLButtonElement
    expect(publish.disabled).toBe(false)
    expect((screen.getAllByLabelText('הסרת התמונה')[0] as HTMLButtonElement).disabled).toBe(false)
    // And the photo it could not remove is still there.
    expect(screen.getAllByAltText('').length).toBe(3)
  })

  it('offers to group photos that never got an item', async () => {
    clusterBatchAction.mockResolvedValue({ ok: false, error: 'לא נמצאו תמונות לייבוא.' })
    renderReview({ loosePhotos: [{ id: 'p9', lqip: 'data:,' }] })

    fireEvent.click(screen.getByText('קיבוץ התמונות שנותרו לפריטים'))

    await waitFor(() => expect(clusterBatchAction).toHaveBeenCalledWith('batch-1'))
    await waitFor(() => expect(screen.getByText('לא נמצאו תמונות לייבוא.')).toBeTruthy())
  })

  it('sends the seller back to their items when the import has nothing left in it', () => {
    renderReview({ items: [] })
    expect(screen.getByText('אין פריטים בייבוא הזה.')).toBeTruthy()
    expect(screen.getByText('לרשימת הפריטים').getAttribute('href')).toBe('/admin/items')
  })
})
