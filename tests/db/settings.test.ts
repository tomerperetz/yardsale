import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeItem } from '../helpers/factories'
import { getSettings, missingSettings, shopIsOpen } from '@/lib/settings'
import { reserveItems } from '@/lib/orders/reserve'
import { utcDate } from '@/lib/dates'
import { PickupSlot } from '@prisma/client'

// `saveSettingsAction` ends in revalidatePath, which needs a real request
// context Next only provides while serving. The database write is what this
// file is about, so stub the cache invalidation out.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

/**
 * A missing Settings row used to 500 every server-rendered page — including
 * /admin/settings, the one screen that can fix it. The shop must instead
 * degrade into the first-run state it already knows how to render.
 */
describe('getSettings with no Settings row', () => {
  beforeEach(resetDb)

  it('resolves with every field empty instead of throwing', async () => {
    const s = await getSettings()
    expect(s.shopName).toBe('')
    expect(s.tagline).toBe('')
    expect(s.bitPhone).toBe('')
    expect(s.addressLine).toBe('')
    expect(s.city).toBe('')
    expect(s.slotMorning).toBe('')
    expect(s.slotAfternoon).toBe('')
    expect(s.slotEvening).toBe('')
    expect(s.holdMinutes).toBe(15)
    expect(s.dismissedMerges).toEqual([])
  })

  it('never creates the row as a side effect of reading', async () => {
    await getSettings()
    expect(await db.settings.count()).toBe(0)
  })

  it('hands back a fresh dismissedMerges array each call', async () => {
    const a = await getSettings()
    a.dismissedMerges.push('x:y')
    expect((await getSettings()).dismissedMerges).toEqual([])
  })

  it('leaves the shop closed and lists every missing field', async () => {
    const s = await getSettings()
    expect(shopIsOpen(s)).toBe(false)
    expect(missingSettings(s)).toEqual(['shopName', 'bitPhone', 'addressLine', 'city'])
  })

  it('refuses checkout with SHOP_NOT_OPEN rather than reserving anything', async () => {
    const item = await makeItem()

    const result = await reserveItems({
      itemIds: [item.id],
      buyerName: 'קונה',
      buyerPhone: '0501234567',
      pickupDate: utcDate(2026, 9, 15),
      pickupSlot: PickupSlot.AFTERNOON,
    })

    expect(result).toEqual({ ok: false, reason: 'SHOP_NOT_OPEN' })
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('AVAILABLE')
  })

  it('reads back the saved values once a row exists', async () => {
    await db.settings.create({ data: { ...(await getSettings()), shopName: 'חצר', bitPhone: '0501234567' } })
    const s = await getSettings()
    expect(s.shopName).toBe('חצר')
    expect(shopIsOpen(s)).toBe(true)
  })
})

describe('saveSettingsAction with no Settings row', () => {
  beforeEach(resetDb)

  it('creates the row, so the seller can reopen the shop from inside the app', async () => {
    const { saveSettingsAction } = await import('@/app/admin/settings/actions')

    const result = await saveSettingsAction({
      shopName: 'חצר',
      tagline: '',
      bitPhone: '0501234567',
      addressLine: 'הרצל 1',
      city: 'תל אביב',
      slotMorning: '',
      slotAfternoon: '',
      slotEvening: '',
      holdMinutes: '15',
    })

    expect(result).toEqual({ ok: true })
    expect(await db.settings.count()).toBe(1)
    expect(shopIsOpen(await getSettings())).toBe(true)
  })
})
