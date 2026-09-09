import { OrderStatus, ItemStatus } from '@prisma/client'

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.CLAIMED_PAID, OrderStatus.EXPIRED, OrderStatus.CANCELLED],
  [OrderStatus.CLAIMED_PAID]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  // PAID is not terminal, but it is the one cancellation that undoes a
  // finished sale rather than releasing a hold: the seller has the money and
  // the items are SOLD. Cancelling puts those items back on the shop for
  // anyone to buy, and NOTHING here records the refund now owed — no balance,
  // no reminder, no reconciliation. The order keeps both stamps (`confirmedAt`
  // and `cancelledAt`), which is the only trace left that money changed hands
  // and now has to go back; OrderRowActions.tsx reads them to warn the seller
  // before the fact and to keep the WhatsApp button after it. Do not add
  // PAID -> anything else: the sale either stands or is undone whole, and it
  // is never re-opened.
  [OrderStatus.PAID]: [OrderStatus.CANCELLED],
  [OrderStatus.EXPIRED]: [],
  [OrderStatus.CANCELLED]: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** The status every item on an order takes when the order reaches this status. */
export function itemStatusForOrderStatus(s: OrderStatus): ItemStatus {
  switch (s) {
    case OrderStatus.PENDING_PAYMENT:
    case OrderStatus.CLAIMED_PAID:
      return ItemStatus.RESERVED
    case OrderStatus.PAID:
      return ItemStatus.SOLD
    case OrderStatus.EXPIRED:
    case OrderStatus.CANCELLED:
      return ItemStatus.AVAILABLE
  }
}

/** The 15-minute clock runs only until the buyer says they have paid. */
export function holdIsRunning(s: OrderStatus): boolean {
  return s === OrderStatus.PENDING_PAYMENT
}
