'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { normalizeIsraeliMobile } from '@/lib/phone'
import { parseDate } from '@/lib/admin/items'

export type SettingsInput = {
  shopName: string
  tagline: string
  bitPhone: string
  addressLine: string
  city: string
  slotMorning: string
  slotAfternoon: string
  slotEvening: string
  /** Both `<input type="date">` values, or both empty — see `saleDates`. */
  saleFrom: string
  saleTo: string
  holdMinutes: string
}

export type SettingsResult = { ok: true } | { ok: false; error: string }

type SaleDatesResult = { error: string } | { saleFrom: Date | null; saleTo: Date | null }

/**
 * The sale's collection window, as the two nullable `@db.Date` columns.
 *
 * Both ends or neither: half a window is not one, and every reader
 * (`saleWindow`) treats a row holding one end as unset, so accepting one here
 * would save something the shop then ignores. Clearing both is a real choice —
 * it returns new items to the today → today+14 fallback.
 *
 * Parsed with the item form's own `parseDate`, so a window typed here is read
 * by exactly the rule that reads a pickup window typed anywhere else.
 */
function saleDates(fromRaw: string, toRaw: string): SaleDatesResult {
  const from = fromRaw.trim()
  const to = toRaw.trim()
  if (from === '' && to === '') return { saleFrom: null, saleTo: null }
  if (from === '' || to === '') {
    return { error: 'צריך למלא את שני תאריכי המכירה, או להשאיר את שניהם ריקים.' }
  }

  const saleFrom = parseDate(from)
  const saleTo = parseDate(to)
  if (!saleFrom || !saleTo) return { error: 'תאריכי המכירה לא תקינים.' }
  if (saleTo.getTime() < saleFrom.getTime()) return { error: 'חלון המכירה מסתיים לפני שהוא מתחיל.' }

  return { saleFrom, saleTo }
}

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

  const sale = saleDates(input.saleFrom, input.saleTo)
  if ('error' in sale) return { ok: false, error: sale.error }

  const fields = {
    shopName: input.shopName.trim(),
    tagline: input.tagline.trim(),
    bitPhone,
    addressLine: input.addressLine.trim(),
    city: input.city.trim(),
    slotMorning: input.slotMorning.trim(),
    slotAfternoon: input.slotAfternoon.trim(),
    slotEvening: input.slotEvening.trim(),
    saleFrom: sale.saleFrom,
    saleTo: sale.saleTo,
    holdMinutes,
  }

  // upsert, not update: `getSettings()` degrades a missing row into an
  // all-empty first-run shop rather than 500ing every page, so this screen
  // stays reachable with no row at all — and saving from it has to be what
  // creates the row. A read never creates it (see src/lib/settings.ts).
  await db.settings.upsert({ where: { id: 1 }, update: fields, create: { id: 1, ...fields } })

  revalidatePath('/admin/settings')
  revalidatePath('/admin/items')
  revalidatePath('/admin/orders')
  revalidatePath('/')
  return { ok: true }
}
