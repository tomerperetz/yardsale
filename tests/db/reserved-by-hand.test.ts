import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { setItemStatus } from '@/lib/admin/items'
import { SELLABLE_STATUSES } from '@/lib/admin/item-status'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder } from '../helpers/factories'

const statusOf = async (id: string) => (await db.item.findUniqueOrThrow({ where: { id } })).status

/**
 * RESERVED has two owners as of 2026-09-15.
 *
 * The order flow sets it when a buyer holds an item, and that claim is not the
 * seller's to move. The seller sets the same status by hand for the other kind
 * of reservation this shop runs on — someone messaged saying they will come on
 * Friday for the washing machine — and must be able to take it back off.
 *
 * Which of the two an item is in is not stored. It is whether a live order is
 * currently counting on the item, which the database already knows.
 */
describe('a seller reserving an item by hand', () => {
  beforeEach(resetDb)

  it('is offered as a status the seller can set', () => {
    expect(SELLABLE_STATUSES).toContain('RESERVED')
  })

  it('takes an available item off sale without hiding it', async () => {
    const item = await makeItem()

    expect(await setItemStatus(item.id, 'RESERVED')).toMatchObject({ ok: true })
    expect(await statusOf(item.id)).toBe(ItemStatus.RESERVED)
  })

  it('can be taken back off again — the whole reason it is a status and not a hide', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })

    expect(await setItemStatus(item.id, 'AVAILABLE')).toMatchObject({ ok: true })
    expect(await statusOf(item.id)).toBe(ItemStatus.AVAILABLE)
  })

  it('can go straight to sold, which is how most of these end', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })

    expect(await setItemStatus(item.id, 'SOLD')).toMatchObject({ ok: true })
    expect(await statusOf(item.id)).toBe(ItemStatus.SOLD)
  })

  it.each([OrderStatus.PENDING_PAYMENT, OrderStatus.CLAIMED_PAID, OrderStatus.PAID])(
    'still refuses to move an item a %s order is holding',
    async (status) => {
      // The regression this guards. Letting the seller release a hold by hand
      // would take an item out from under a buyer who chose a pickup slot and,
      // on a confirmed order, already sent money.
      const item = await makeItem({ status: ItemStatus.RESERVED })
      await makeOrder([item.id], { status })

      const result = await setItemStatus(item.id, 'AVAILABLE')

      expect(result).toMatchObject({ ok: false })
      expect(await statusOf(item.id)).toBe(ItemStatus.RESERVED)
    },
  )

  it('refuses to reserve an item that is already sold through the shop', async () => {
    const item = await makeItem({ status: ItemStatus.SOLD })
    await makeOrder([item.id], { status: OrderStatus.PAID })

    expect(await setItemStatus(item.id, 'RESERVED')).toMatchObject({ ok: false })
    expect(await statusOf(item.id)).toBe(ItemStatus.SOLD)
  })

  it('refuses to reserve a draft, which has never been published', async () => {
    const item = await makeItem({ status: ItemStatus.DRAFT })

    expect(await setItemStatus(item.id, 'RESERVED')).toMatchObject({ ok: false })
    expect(await statusOf(item.id)).toBe(ItemStatus.DRAFT)
  })

  it('cannot be bought: reserving takes it out of what checkout will hold', async () => {
    // `reserveItems` matches on status AVAILABLE, so this is the property that
    // makes the badge honest rather than decorative.
    const item = await makeItem()
    await setItemStatus(item.id, 'RESERVED')

    const held = await db.item.count({ where: { id: item.id, status: ItemStatus.AVAILABLE } })
    expect(held).toBe(0)
  })

  it('stays visible to buyers — it is not hidden, and its link keeps working', async () => {
    const item = await makeItem()
    await setItemStatus(item.id, 'RESERVED')

    const { publicItemWhere } = await import('@/lib/visibility')
    expect(await db.item.count({ where: { id: item.id, ...publicItemWhere } })).toBe(1)
  })
})
