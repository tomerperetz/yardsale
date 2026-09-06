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
}

/** Only the settings fields a WhatsApp message ever needs to read. */
export type SettingsForMessage = {
  shopName: string
  addressLine: string
  city: string
  slotMorning: string
  slotAfternoon: string
  slotEvening: string
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

/** Builds the Hebrew WhatsApp message the seller sends for the order's current state. */
export function messageForOrder(order: OrderForMessage, settings: SettingsForMessage): string {
  const shop = settings.shopName ? ` ב${settings.shopName}` : ''

  switch (order.status) {
    case OrderStatus.PENDING_PAYMENT:
      return (
        `היי ${order.buyerName}, ההזמנה שלך ${order.code}${shop} נשמרה וממתינה לתשלום בביט ` +
        `על סך ${formatAgorot(order.totalAgorot)}. יש 15 דקות להעביר את התשלום וללחוץ על "שילמתי בביט" ` +
        `באתר, אחרת ההזמנה תתבטל אוטומטית והפריטים יחזרו למלאי.`
      )

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
