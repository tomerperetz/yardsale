// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The status chip in the item table, which is a control rather than a label.
 *
 * The actions are mocked — they carry 'use server' and pull Prisma — so what
 * is asserted here is what the chip ASKS them to do, and the one thing it must
 * never do: delete on a single press.
 */
const setItemStatusAction = vi.fn()
const deleteItemAction = vi.fn()
vi.mock('@/app/admin/items/actions', () => ({
  setItemStatusAction: (...args: unknown[]) => setItemStatusAction(...args),
  deleteItemAction: (...args: unknown[]) => deleteItemAction(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { ItemStatusCell } from '@/app/admin/items/ItemStatusCell'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  setItemStatusAction.mockResolvedValue({ ok: true, id: 'i1', slug: 's' })
  deleteItemAction.mockResolvedValue({ ok: true })
})

const open = () => fireEvent.click(screen.getByRole('button', { name: /שינוי הסטטוס/ }))

describe('the status chip', () => {
  it('shows the current status, in Hebrew', () => {
    render(<ItemStatusCell id="i1" status="SOLD" name="מיקרוגל" />)
    expect(screen.getByRole('button', { name: /כרגע: נמכר/ })).toBeTruthy()
  })

  it('offers all four seller statuses once opened', () => {
    render(<ItemStatusCell id="i1" status="AVAILABLE" name="מיקרוגל" />)
    open()
    for (const label of ['זמין', 'שמור', 'מוסתר', 'נמכר']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('changes the status of a SOLD item — the thing that could not be done from here', async () => {
    render(<ItemStatusCell id="i1" status="SOLD" name="מיקרוגל" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'זמין' }))

    await waitFor(() => expect(setItemStatusAction).toHaveBeenCalledWith('i1', 'AVAILABLE'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('does nothing when the seller picks the status it already has', async () => {
    render(<ItemStatusCell id="i1" status="AVAILABLE" name="מיקרוגל" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'זמין' }))

    expect(setItemStatusAction).not.toHaveBeenCalled()
  })

  it('never deletes on one press', () => {
    // The one irreversible thing on this screen, sitting one row below four
    // reversible ones.
    render(<ItemStatusCell id="i1" status="AVAILABLE" name="מיקרוגל" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת הפריט' }))

    expect(deleteItemAction).not.toHaveBeenCalled()
    expect(screen.getByText(/אי אפשר לבטל/)).toBeTruthy()
  })

  it('deletes on the second press', async () => {
    render(<ItemStatusCell id="i1" status="SOLD" name="מיקרוגל" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת הפריט' }))
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }))

    await waitFor(() => expect(deleteItemAction).toHaveBeenCalledWith('i1'))
  })

  it('lets the seller back out of the confirmation', () => {
    render(<ItemStatusCell id="i1" status="AVAILABLE" name="מיקרוגל" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת הפריט' }))
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }))

    expect(deleteItemAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'כן, למחוק' })).toBeNull()
  })

  it('shows the server’s refusal instead of pretending it worked', async () => {
    deleteItemAction.mockResolvedValue({ ok: false, error: 'אי אפשר למחוק פריט ששייך להזמנה. בטלו את ההזמנה קודם.' })
    render(<ItemStatusCell id="i1" status="SOLD" name="מיקרוגל" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת הפריט' }))
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('הזמנה'))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('offers a DRAFT no statuses, and says where it is published from', () => {
    // `setItemStatus` refuses a draft; offering the buttons would be an
    // invitation to an error message.
    render(<ItemStatusCell id="i1" status="DRAFT" name="פריט חדש" />)
    open()

    expect(screen.queryByRole('button', { name: 'זמין' })).toBeNull()
    expect(screen.getByText(/מסך הייבוא/)).toBeTruthy()
  })

  it('still lets a stray DRAFT be deleted, which is how a bad import is cleaned up', () => {
    render(<ItemStatusCell id="i1" status="DRAFT" name="פריט חדש" />)
    open()
    expect(screen.getByRole('button', { name: 'מחיקת הפריט' })).toBeTruthy()
  })
})
