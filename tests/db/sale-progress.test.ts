import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus } from '@prisma/client'
import { saleProgress } from '@/lib/admin/sale-progress'
import { resetDb } from '../helpers/db'
import { makeItem } from '../helpers/factories'

describe('saleProgress', () => {
  beforeEach(resetDb)

  it('counts the sale as what a buyer could put money on', async () => {
    await makeItem({ priceAgorot: 10_000 })
    await makeItem({ priceAgorot: 20_000, status: ItemStatus.RESERVED })
    await makeItem({ priceAgorot: 30_000, status: ItemStatus.SOLD })

    expect(await saleProgress()).toEqual({
      itemsSold: 1,
      itemsTotal: 3,
      soldAgorot: 30_000,
      potentialAgorot: 60_000,
    })
  })

  it('leaves drafts out of both sides', async () => {
    // An unpublished photograph is not inventory. Counting it would make the
    // shop look emptier the more the seller imports, and its price of 0 would
    // drag the money bar down with it.
    await makeItem({ priceAgorot: 10_000 })
    await makeItem({ priceAgorot: 0, status: ItemStatus.DRAFT })

    expect(await saleProgress()).toMatchObject({ itemsTotal: 1, potentialAgorot: 10_000 })
  })

  it('leaves hidden items out of both sides', async () => {
    // Withheld from the shop on purpose: not for sale today, so not part of
    // what today's sale can earn.
    await makeItem({ priceAgorot: 10_000 })
    await makeItem({ priceAgorot: 90_000, status: ItemStatus.HIDDEN })

    expect(await saleProgress()).toMatchObject({ itemsTotal: 1, potentialAgorot: 10_000 })
  })

  it('counts a sold item on both sides, so the bar can never pass its own total', async () => {
    await makeItem({ priceAgorot: 25_000, status: ItemStatus.SOLD })

    const progress = await saleProgress()
    expect(progress.soldAgorot).toBe(progress.potentialAgorot)
    expect(progress.itemsSold).toBe(progress.itemsTotal)
  })

  it('reports zeroes for an empty shop rather than nulls', async () => {
    // Prisma's _sum is null when nothing matched, and a null would render as
    // an empty price and divide into NaN.
    expect(await saleProgress()).toEqual({
      itemsSold: 0,
      itemsTotal: 0,
      soldAgorot: 0,
      potentialAgorot: 0,
    })
  })

  it('reports zero money against a real total before the first sale', async () => {
    await makeItem({ priceAgorot: 10_000 })
    await makeItem({ priceAgorot: 5_000 })

    expect(await saleProgress()).toEqual({
      itemsSold: 0,
      itemsTotal: 2,
      soldAgorot: 0,
      potentialAgorot: 15_000,
    })
  })
})
