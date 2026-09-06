'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { PickupSlot } from '@prisma/client'
import { MAX_ITEMS_PER_ORDER, reserveItems } from '@/lib/orders/reserve'
import { normalizeIsraeliMobile } from '@/lib/phone'
import { hit } from '@/lib/rate-limit'

export type CheckoutState = { error?: string; unavailableItemIds?: string[] }

export async function checkout(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  // The only unauthenticated endpoint that changes item availability. Each
  // call can hold real goods off the shop for a full hold window, so it is
  // rate limited exactly like /admin/login. The key is namespaced so buyers
  // and the seller's login do not share a per-IP bucket.
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (!hit(`checkout:${ip}`).allowed) return { error: 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.' }

  const itemIds = String(formData.get('itemIds') ?? '').split(',').filter(Boolean)
  const buyerName = String(formData.get('buyerName') ?? '').trim()
  const phone = normalizeIsraeliMobile(String(formData.get('buyerPhone') ?? ''))
  const slot = String(formData.get('pickupSlot') ?? '')
  const dateRaw = String(formData.get('pickupDate') ?? '')

  if (buyerName.length < 2) return { error: 'צריך שם מלא.' }
  if (!phone) return { error: 'מספר הטלפון לא נראה תקין.' }
  if (!(slot in PickupSlot)) return { error: 'צריך לבחור שעת איסוף.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: 'צריך לבחור יום איסוף.' }

  const result = await reserveItems({
    itemIds,
    buyerName,
    buyerPhone: phone,
    pickupDate: new Date(`${dateRaw}T00:00:00Z`),
    pickupSlot: slot as PickupSlot,
  })

  if (result.ok) redirect(`/pay/${result.token}`)

  switch (result.reason) {
    case 'EMPTY_CART':
      return { error: 'הסל ריק.' }
    case 'TOO_MANY_ITEMS':
      return { error: `אפשר להזמין עד ${MAX_ITEMS_PER_ORDER} פריטים בהזמנה אחת.` }
    case 'UNAVAILABLE':
      return { error: 'חלק מהפריטים נתפסו בינתיים.', unavailableItemIds: result.unavailableItemIds }
    case 'BAD_PICKUP_DATE':
      return { error: 'יום האיסוף שנבחר כבר לא מתאים לכל הפריטים.' }
    case 'SHOP_NOT_OPEN':
      return { error: 'החנות עדיין לא פתוחה להזמנות.' }
  }
}
