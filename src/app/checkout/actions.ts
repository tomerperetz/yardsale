'use server'

import { redirect } from 'next/navigation'
import { PickupSlot } from '@prisma/client'
import { reserveItems } from '@/lib/orders/reserve'
import { normalizeIsraeliMobile } from '@/lib/phone'

export type CheckoutState = { error?: string; unavailableItemIds?: string[] }

export async function checkout(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
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
    case 'UNAVAILABLE':
      return { error: 'חלק מהפריטים נתפסו בינתיים.', unavailableItemIds: result.unavailableItemIds }
    case 'BAD_PICKUP_DATE':
      return { error: 'יום האיסוף שנבחר כבר לא מתאים לכל הפריטים.' }
    case 'SHOP_NOT_OPEN':
      return { error: 'החנות עדיין לא פתוחה להזמנות.' }
  }
}
