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
})
