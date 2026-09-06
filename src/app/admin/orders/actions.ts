'use server'

import { revalidatePath } from 'next/cache'
import { confirmPayment, cancelOrder } from '@/lib/orders/transitions'

export type OrderActionResult = { ok: true } | { ok: false; error: string }

function messageFor(reason: 'NOT_FOUND' | 'ILLEGAL' | 'EXPIRED'): string {
  switch (reason) {
    case 'NOT_FOUND':
      return 'לא מצאנו את ההזמנה.'
    case 'EXPIRED':
      return 'ההזמנה כבר פגה — הפריטים חזרו למכירה.'
    case 'ILLEGAL':
      return 'אי אפשר לבצע את הפעולה במצב הנוכחי של ההזמנה.'
  }
}

/**
 * Thin 'use server' wrappers around src/lib/orders/transitions.ts — the
 * state rules themselves live there and are not re-encoded here.
 */
export async function confirmPaymentAction(orderId: string): Promise<OrderActionResult> {
  const result = await confirmPayment(orderId)
  if (!result.ok) return { ok: false, error: messageFor(result.reason) }
  revalidatePath('/admin/orders')
  return { ok: true }
}

export async function cancelOrderAction(orderId: string): Promise<OrderActionResult> {
  const result = await cancelOrder(orderId)
  if (!result.ok) return { ok: false, error: messageFor(result.reason) }
  revalidatePath('/admin/orders')
  return { ok: true }
}
