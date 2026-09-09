// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The row controls on /admin/orders (spec §8), and specifically the two
 * confirmations behind `ביטול`. The server actions are mocked: they carry
 * 'use server' and pull Prisma, which cannot run under jsdom, and what is
 * worth asserting here is what the seller is told before the action is called
 * at all — the state rules themselves are tested against a real database in
 * tests/db/transitions.test.ts.
 *
 * Cancelling a confirmed sale is the only destructive thing this screen can
 * do, and the app will never mention the refund again, so the wording of that
 * one confirmation is treated as behaviour and asserted like behaviour.
 */
const confirmPaymentAction = vi.fn()
const cancelOrderAction = vi.fn()
vi.mock('@/app/admin/orders/actions', () => ({
  confirmPaymentAction: (...args: unknown[]) => confirmPaymentAction(...args),
  cancelOrderAction: (...args: unknown[]) => cancelOrderAction(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { OrderRowActions } from '@/app/admin/orders/OrderRowActions'

type Status = 'PENDING_PAYMENT' | 'CLAIMED_PAID' | 'PAID' | 'EXPIRED' | 'CANCELLED'

function renderRow(status: Status, overrides: { paymentConfirmed?: boolean } = {}) {
  return render(
    <OrderRowActions
      orderId="order-1"
      token="tok-1"
      status={status}
      buyerName="מיכל אברהמי"
      totalAgorot={168000}
      paymentConfirmed={overrides.paymentConfirmed ?? status === 'PAID'}
      waHref="https://wa.me/972527418830?text=x"
    />,
  )
}

const cancelButton = () => screen.getByRole('button', { name: 'ביטול' })

beforeEach(() => {
  confirmPaymentAction.mockResolvedValue({ ok: true })
  cancelOrderAction.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('OrderRowActions', () => {
  it('offers cancellation on every live order, including a paid one', () => {
    for (const status of ['PENDING_PAYMENT', 'CLAIMED_PAID', 'PAID'] as const) {
      renderRow(status)
      expect(cancelButton()).toBeTruthy()
      cleanup()
    }
  })

  it('offers nothing to cancel on an order that is already dead', () => {
    for (const status of ['EXPIRED', 'CANCELLED'] as const) {
      renderRow(status, { paymentConfirmed: false })
      expect(screen.queryByRole('button', { name: 'ביטול' })).toBeNull()
      cleanup()
    }
  })

  it('asks before cancelling anything, and calls nothing until the seller says yes', async () => {
    renderRow('PENDING_PAYMENT')
    fireEvent.click(cancelButton())

    expect(cancelOrderAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'כן, לבטל' }))
    await waitFor(() => expect(cancelOrderAction).toHaveBeenCalledWith('order-1'))
  })

  it('keeps a pending order alive when the seller backs out', () => {
    renderRow('PENDING_PAYMENT')
    fireEvent.click(cancelButton())
    fireEvent.click(screen.getByRole('button', { name: 'לא, להשאיר' }))

    expect(cancelOrderAction).not.toHaveBeenCalled()
    expect(cancelButton()).toBeTruthy()
  })

  it('asks a pending order in one line, with no talk of money', () => {
    const { container } = renderRow('PENDING_PAYMENT')
    fireEvent.click(cancelButton())

    const text = container.textContent ?? ''
    expect(text).toContain('לבטל את ההזמנה של מיכל אברהמי?')
    expect(text).toContain('הפריטים יחזרו למכירה')
    expect(text).not.toContain('₪1,680')
    expect(text).not.toContain('החזר')
  })

  it('asks a claimed-paid order the same light question, since no money has been confirmed', () => {
    const { container } = renderRow('CLAIMED_PAID')
    fireEvent.click(cancelButton())

    const text = container.textContent ?? ''
    expect(text).toContain('לבטל את ההזמנה של מיכל אברהמי?')
    expect(text).not.toContain('₪1,680')
  })

  /**
   * The whole point of the feature being two features. A seller undoing a
   * confirmed sale is giving back money the app does not track, and handing
   * items someone has paid for to whoever buys them next — so the question
   * names the buyer, the amount, both consequences, and the fact that nobody
   * will remind them.
   */
  it('spells out what cancelling a confirmed sale costs before doing it', () => {
    const { container } = renderRow('PAID')
    fireEvent.click(cancelButton())

    const text = container.textContent ?? ''
    expect(text).toContain('מיכל אברהמי')
    expect(text).toContain('₪1,680')
    expect(text).toContain('יחזיר את הפריטים למכירה')
    expect(text).toContain('החזר')
    expect(text).toContain('האתר לא עוקב אחרי החזרים')
    // Not the one-line question the other two get.
    expect(text).not.toContain('לבטל את ההזמנה של מיכל אברהמי?')
    expect(screen.getByRole('button', { name: 'כן, לבטל ולהחזיר את הכסף' })).toBeTruthy()
  })

  it('cancels a confirmed sale once the seller has read that and agreed', async () => {
    renderRow('PAID')
    fireEvent.click(cancelButton())
    fireEvent.click(screen.getByRole('button', { name: 'כן, לבטל ולהחזיר את הכסף' }))

    await waitFor(() => expect(cancelOrderAction).toHaveBeenCalledWith('order-1'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  // A concurrent confirmation, an order swept out from under the seller: the
  // refusal is the server's to word, and it has to reach the row rather than
  // leaving the seller looking at a question that quietly did nothing.
  it('shows the server refusal in the row and keeps the question open', async () => {
    cancelOrderAction.mockResolvedValue({ ok: false, error: 'אי אפשר לבצע את הפעולה במצב הנוכחי של ההזמנה.' })
    renderRow('PAID')
    fireEvent.click(cancelButton())
    fireEvent.click(screen.getByRole('button', { name: 'כן, לבטל ולהחזיר את הכסף' }))

    await waitFor(() =>
      expect(screen.getByText('אי אפשר לבצע את הפעולה במצב הנוכחי של ההזמנה.')).toBeTruthy(),
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'כן, לבטל ולהחזיר את הכסף' })).toBeTruthy()
  })

  // The seller owes this buyer money and the app tracks none of it, so the
  // one channel it does offer must not disappear the moment the order dies.
  it('keeps WhatsApp on a cancelled order that had been confirmed as paid', () => {
    renderRow('CANCELLED', { paymentConfirmed: true })
    expect(screen.getByRole('link', { name: 'וואטסאפ' })).toBeTruthy()
  })

  it('drops WhatsApp from a cancelled order that never took a payment', () => {
    renderRow('CANCELLED', { paymentConfirmed: false })
    expect(screen.queryByRole('link', { name: 'וואטסאפ' })).toBeNull()
  })

  it('leaves every visible string in Hebrew', () => {
    const { container } = renderRow('PAID')
    fireEvent.click(cancelButton())
    // Prices and digits are fine; Latin letters in seller-facing copy are not.
    expect(container.textContent ?? '').not.toMatch(/[A-Za-z]/)
  })
})
