import { describe, it, expect } from 'vitest'
import { OrderStatus, ItemStatus } from '@prisma/client'
import { canTransition, itemStatusForOrderStatus, holdIsRunning } from '@/lib/orders/state'

describe('canTransition', () => {
  it('allows the happy path', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.CLAIMED_PAID)).toBe(true)
    expect(canTransition(OrderStatus.CLAIMED_PAID, OrderStatus.PAID)).toBe(true)
  })

  it('allows expiry only from pending payment', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.EXPIRED)).toBe(true)
    expect(canTransition(OrderStatus.CLAIMED_PAID, OrderStatus.EXPIRED)).toBe(false)
  })

  it('allows the seller to cancel any live order, a paid one included', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED)).toBe(true)
    expect(canTransition(OrderStatus.CLAIMED_PAID, OrderStatus.CANCELLED)).toBe(true)
    expect(canTransition(OrderStatus.PAID, OrderStatus.CANCELLED)).toBe(true)
  })

  // Cancelling is the only thing a confirmed sale can do. Re-opening one —
  // back to a hold, or to "the buyer says they paid" — would put items the
  // seller has already been paid for back under a clock.
  it('lets a paid order be cancelled and nothing else', () => {
    for (const to of Object.values(OrderStatus)) {
      expect(canTransition(OrderStatus.PAID, to)).toBe(to === OrderStatus.CANCELLED)
    }
  })

  it('never moves out of a terminal state', () => {
    for (const to of Object.values(OrderStatus)) {
      expect(canTransition(OrderStatus.EXPIRED, to)).toBe(false)
      expect(canTransition(OrderStatus.CANCELLED, to)).toBe(false)
    }
  })

  it('never skips straight from pending payment to paid', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.PAID)).toBe(false)
  })

  it('never transitions to itself', () => {
    for (const s of Object.values(OrderStatus)) {
      expect(canTransition(s, s)).toBe(false)
    }
  })
})

describe('itemStatusForOrderStatus', () => {
  it('holds items while payment is outstanding or unconfirmed', () => {
    expect(itemStatusForOrderStatus(OrderStatus.PENDING_PAYMENT)).toBe(ItemStatus.RESERVED)
    expect(itemStatusForOrderStatus(OrderStatus.CLAIMED_PAID)).toBe(ItemStatus.RESERVED)
  })

  it('sells items once payment is confirmed', () => {
    expect(itemStatusForOrderStatus(OrderStatus.PAID)).toBe(ItemStatus.SOLD)
  })

  it('releases items on expiry and cancellation', () => {
    expect(itemStatusForOrderStatus(OrderStatus.EXPIRED)).toBe(ItemStatus.AVAILABLE)
    expect(itemStatusForOrderStatus(OrderStatus.CANCELLED)).toBe(ItemStatus.AVAILABLE)
  })
})

describe('holdIsRunning', () => {
  it('is true only while waiting for the buyer to declare payment', () => {
    expect(holdIsRunning(OrderStatus.PENDING_PAYMENT)).toBe(true)
    expect(holdIsRunning(OrderStatus.CLAIMED_PAID)).toBe(false)
    expect(holdIsRunning(OrderStatus.PAID)).toBe(false)
  })
})
