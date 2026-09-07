import { describe, it, expect } from 'vitest'
import { OrderStatus, PickupSlot } from '@prisma/client'
import { messageForOrder, waLink } from '@/lib/whatsapp'
import { utcDate } from '@/lib/dates'

const settings = {
  shopName: 'חנות', addressLine: 'הרצל 5', city: 'רמת גן',
  slotAfternoon: '12:00–17:00', slotMorning: '', slotEvening: '',
}

const order = {
  code: 'YS-4821', buyerName: 'מיכל', buyerPhone: '0527418830',
  totalAgorot: 168000, pickupDate: utcDate(2026, 9, 15),
  pickupSlot: PickupSlot.AFTERNOON, status: OrderStatus.CLAIMED_PAID,
}

describe('waLink', () => {
  it('builds an international wa.me url with an encoded message', () => {
    const url = waLink('0527418830', 'שלום')
    expect(url.startsWith('https://wa.me/972527418830?text=')).toBe(true)
    expect(url).toContain(encodeURIComponent('שלום'))
  })
})

describe('messageForOrder', () => {
  it('confirms pickup details once payment is confirmed', () => {
    const msg = messageForOrder({ ...order, status: OrderStatus.PAID }, settings)
    expect(msg).toContain('YS-4821')
    expect(msg).toContain('הרצל 5')
    expect(msg).toContain('12:00–17:00')
  })

  it('isolates the hour range so WhatsApp cannot reverse it', () => {
    // Bare in a Hebrew sentence, "12:00–17:00" is two LTR runs around a neutral
    // dash and the bidi algorithm lays them out right-to-left — the buyer reads
    // an end time before its start. U+2068/U+2069 pin the order.
    const msg = messageForOrder({ ...order, status: OrderStatus.PAID }, settings)
    expect(msg).toContain('⁨12:00–17:00⁩')
  })

  it('chases payment while the order is still pending', () => {
    const msg = messageForOrder({ ...order, status: OrderStatus.PENDING_PAYMENT }, settings)
    expect(msg).toContain('YS-4821')
    expect(msg).toContain('₪1,680')
  })

  it('acknowledges a claimed payment without promising it cleared', () => {
    const msg = messageForOrder(order, settings)
    expect(msg).toContain('YS-4821')
  })

  it('never contains an undefined or empty placeholder', () => {
    for (const status of Object.values(OrderStatus)) {
      const msg = messageForOrder({ ...order, status }, settings)
      expect(msg).not.toContain('undefined')
      expect(msg.trim().length).toBeGreaterThan(10)
    }
  })

  it('never leaves an undefined, a stray comma run, or a dangling connector when every seller-facing setting is empty', () => {
    // A Settings row exactly as seeded on day one: nothing filled in yet.
    const emptySettings = {
      shopName: '',
      tagline: '',
      bitPhone: '',
      addressLine: '',
      city: '',
      slotMorning: '',
      slotAfternoon: '',
      slotEvening: '',
    }

    for (const status of Object.values(OrderStatus)) {
      const msg = messageForOrder({ ...order, status }, emptySettings)
      expect(msg).not.toContain('undefined')
      expect(msg.trim().length).toBeGreaterThan(10)
      // Dropping an omitted clause (empty shop name, address, slot, or BIT number) must
      // never leave its connector word or its list separator behind.
      expect(msg).not.toMatch(/,\s*,/) // a doubled separator where a joined part went empty
      expect(msg).not.toMatch(/,\s*[.!?]/) // a separator immediately followed by end punctuation
      expect(msg.trim()).not.toMatch(/,$/) // a trailing separator with nothing after it
      expect(msg).not.toMatch(/(^|\s)ב([.,!?]|$)/) // a lone "ב" connector with nothing to attach to
    }
  })

  it('states the real remaining time when the hold is still running, not a fixed number', () => {
    const now = new Date('2026-09-10T10:00:00Z')
    const soon = { ...order, status: OrderStatus.PENDING_PAYMENT, holdExpiresAt: new Date('2026-09-10T10:03:00Z') }
    const msg = messageForOrder(soon, settings, now)
    expect(msg).toContain('3')
    expect(msg).not.toContain('15')
  })

  it('says "דקה אחת" rather than "1 דקות" on the last minute', () => {
    const now = new Date('2026-09-10T10:00:00Z')
    const soon = { ...order, status: OrderStatus.PENDING_PAYMENT, holdExpiresAt: new Date('2026-09-10T10:00:40Z') }
    const msg = messageForOrder(soon, settings, now)
    expect(msg).toContain('נשארה לך דקה אחת')
    expect(msg).not.toContain('1 דקות')
  })

  it('makes no minute claim when the order carries no hold to report', () => {
    const msg = messageForOrder({ ...order, status: OrderStatus.PENDING_PAYMENT }, settings)
    expect(msg).not.toContain('דקות')
  })
})
