import { OrderStatus, PickupSlot } from '@prisma/client'
import { formatAgorot } from '@/lib/money'
import { normalizeIsraeliMobile, toInternational } from '@/lib/phone'

/** Only the order fields a WhatsApp message ever needs to read. */
export type OrderForMessage = {
  code: string
  buyerName: string
  buyerPhone: string
  totalAgorot: number
  pickupDate: Date
  pickupSlot: PickupSlot
  status: OrderStatus
  /** Optional: only PENDING_PAYMENT orders carry one, and only that message reads it. */
  holdExpiresAt?: Date | null
}

/** Only the settings fields a WhatsApp message ever needs to read. */
export type SettingsForMessage = {
  shopName: string
  addressLine: string
  city: string
  slotMorning: string
  slotAfternoon: string
  slotEvening: string
  /** Optional: only the PENDING_PAYMENT chase message reads it. */
  bitPhone?: string
}

const pickupDateFormatter = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})

function slotLabel(slot: PickupSlot, settings: SettingsForMessage): string {
  switch (slot) {
    case PickupSlot.MORNING:
      return settings.slotMorning
    case PickupSlot.AFTERNOON:
      return settings.slotAfternoon
    case PickupSlot.EVENING:
      return settings.slotEvening
  }
}

/** "בתאריך X[, בשעות Y][, בכתובת Z]" — the slot and address clauses drop out when Settings hasn't set them yet. */
function pickupDetails(order: OrderForMessage, settings: SettingsForMessage): string {
  const parts = [`בתאריך ${pickupDateFormatter.format(order.pickupDate)}`]

  const slot = slotLabel(order.pickupSlot, settings)
  if (slot) parts.push(`בשעות ${slot}`)

  const address = [settings.addressLine, settings.city].filter(Boolean).join(', ')
  if (address) parts.push(`בכתובת ${address}`)

  return parts.join(', ')
}

/**
 * Whole minutes left on the hold, rounded up so "1 minute left" never reads as "0 minutes left".
 * Returns null when there is nothing true left to say — no hold, or it has already lapsed —
 * so the message can omit the time claim instead of guessing.
 */
function remainingHoldMinutes(order: OrderForMessage, now: Date): number | null {
  if (!order.holdExpiresAt) return null
  const msLeft = order.holdExpiresAt.getTime() - now.getTime()
  return msLeft > 0 ? Math.ceil(msLeft / 60_000) : null
}

/** Builds the Hebrew WhatsApp message the seller sends for the order's current state. */
export function messageForOrder(order: OrderForMessage, settings: SettingsForMessage, now: Date = new Date()): string {
  const shop = settings.shopName ? ` ב${settings.shopName}` : ''

  switch (order.status) {
    case OrderStatus.PENDING_PAYMENT: {
      // Each clause is a complete standalone sentence, so dropping any one of them
      // (no time left to report, no BIT number set yet) never leaves a dangling
      // connector or a stray comma behind — the join is always grammatical.
      const sentences = [`היי ${order.buyerName}, ההזמנה שלך ${order.code}${shop} נשמרה וממתינה לתשלום בביט על סך ${formatAgorot(order.totalAgorot)}.`]

      const minutes = remainingHoldMinutes(order, now)
      if (minutes !== null) sentences.push(`נשארו לך ${minutes} דקות להעברת התשלום.`)

      if (settings.bitPhone) sentences.push(`אפשר להעביר לביט למספר ${settings.bitPhone}.`)

      sentences.push('לאחר התשלום יש ללחוץ על "שילמתי בביט" באתר, אחרת ההזמנה תתבטל אוטומטית והפריטים יחזרו למלאי.')

      return sentences.join(' ')
    }

    case OrderStatus.CLAIMED_PAID:
      return (
        `תודה ${order.buyerName}! קיבלנו סימון שהעברת את התשלום עבור ההזמנה ${order.code}${shop}. ` +
        `אנחנו בודקים את ההעברה ונעדכן אותך ברגע שהתשלום יאושר.`
      )

    case OrderStatus.PAID:
      return (
        `מעולה ${order.buyerName}! התשלום עבור ההזמנה ${order.code}${shop} אושר. ` +
        `אפשר לאסוף את הפריטים ${pickupDetails(order, settings)}. תודה על הקנייה!`
      )

    case OrderStatus.EXPIRED:
      return (
        `היי ${order.buyerName}, הזמן להעברת התשלום עבור ההזמנה ${order.code}${shop} נגמר ` +
        `ולא התקבל תשלום, כך שהפריטים חזרו למלאי. את/ה מוזמן/ת להזמין שוב.`
      )

    case OrderStatus.CANCELLED:
      return `היי ${order.buyerName}, ההזמנה ${order.code}${shop} בוטלה. את/ה מוזמן/ת להזמין מחדש בכל עת.`
  }
}

/** A wa.me deep link to the buyer's number, with the message pre-filled and URL-encoded. */
export function waLink(phone: string, message: string): string {
  const local = normalizeIsraeliMobile(phone) ?? phone
  return `https://wa.me/${toInternational(local)}?text=${encodeURIComponent(message)}`
}
