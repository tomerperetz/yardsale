'use server'

import { revalidatePath } from 'next/cache'
import { claimPaid } from '@/lib/orders/transitions'

/**
 * ILLEGAL here means the order has already left PENDING_PAYMENT by a route
 * that is not expiry — in practice a second tap on a claim that already
 * landed, or an order the seller has since confirmed. That buyer did nothing
 * wrong, so the message is reassurance.
 *
 * An expired order must never get that message. The sweep nulls
 * holdExpiresAt, so `claimPaid` cannot see the lapse in the hold itself and
 * reports EXPIRED from the order's status instead (see
 * src/lib/orders/transitions.ts). Telling that buyer we have their payment
 * would leave them waiting for goods that are back on sale.
 */
export async function declarePaid(_prev: string | null, formData: FormData): Promise<string | null> {
  const token = String(formData.get('token') ?? '')
  const result = await claimPaid(token)
  if (result.ok) {
    revalidatePath(`/pay/${token}`)
    return null
  }
  if (result.reason === 'EXPIRED') {
    // The page itself re-reads the order, so revalidate: the buyer should see
    // the expired screen, not a live countdown with an error under it.
    revalidatePath(`/pay/${token}`)
    return 'ההזמנה פגה. הפריטים חזרו למכירה.'
  }
  if (result.reason === 'NOT_FOUND') return 'לא מצאנו את ההזמנה.'
  return 'כבר קיבלנו את ההודעה שלכם.'
}
