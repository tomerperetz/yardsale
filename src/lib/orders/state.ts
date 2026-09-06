import { OrderStatus, ItemStatus } from '@prisma/client'

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.CLAIMED_PAID, OrderStatus.EXPIRED, OrderStatus.CANCELLED],
  [OrderStatus.CLAIMED_PAID]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [],
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
