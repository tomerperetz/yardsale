'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { normalizeIsraeliMobile } from '@/lib/phone'

export type SettingsInput = {
  shopName: string
  tagline: string
  bitPhone: string
  addressLine: string
  city: string
  slotMorning: string
  slotAfternoon: string
  slotEvening: string
  holdMinutes: string
}

export type SettingsResult = { ok: true } | { ok: false; error: string }

/**
 * The one form over the `Settings` singleton row. `bitPhone` is validated
 * with `normalizeIsraeliMobile` — the same normalizer the buyer-facing
 * checkout uses — because it's the number every WhatsApp chase message
 * and the /pay/[token] screen show verbatim; an unnormalized or malformed
 * number there would misdirect real money. An empty bitPhone is allowed:
 * it just means the shop isn't open for orders yet (see `shopIsOpen`).
 */
export async function saveSettingsAction(input: SettingsInput): Promise<SettingsResult> {
  const bitPhoneRaw = input.bitPhone.trim()
  let bitPhone = ''
  if (bitPhoneRaw !== '') {
    const normalized = normalizeIsraeliMobile(bitPhoneRaw)
    if (!normalized) return { ok: false, error: 'מספר טלפון לביט לא תקין.' }
    bitPhone = normalized
  }

  const holdMinutes = Number(input.holdMinutes)
  if (!Number.isInteger(holdMinutes) || holdMinutes <= 0) {
    return { ok: false, error: 'משך ההמתנה לתשלום צריך להיות מספר שלם חיובי של דקות.' }
  }

  await db.settings.update({
    where: { id: 1 },
    data: {
      shopName: input.shopName.trim(),
      tagline: input.tagline.trim(),
      bitPhone,
      addressLine: input.addressLine.trim(),
      city: input.city.trim(),
      slotMorning: input.slotMorning.trim(),
      slotAfternoon: input.slotAfternoon.trim(),
      slotEvening: input.slotEvening.trim(),
      holdMinutes,
    },
  })

  revalidatePath('/admin/settings')
  revalidatePath('/admin/items')
  revalidatePath('/admin/orders')
  revalidatePath('/')
  return { ok: true }
}
