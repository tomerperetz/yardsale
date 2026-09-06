import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ItemStatus, OrderStatus } from '@prisma/client'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder } from '../helpers/factories'
import { releaseExpiredHolds } from '@/lib/orders/sweep'

// revalidatePath needs a request context Next only provides while serving.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const EXPIRED_MESSAGE = 'ההזמנה פגה. הפריטים חזרו למכירה.'
const ALREADY_MESSAGE = 'כבר קיבלנו את ההודעה שלכם.'

function form(token: string): FormData {
  const fd = new FormData()
  fd.append('token', token)
  return fd
}

/**
 * What this screen says decides what a buyer does next with their own money.
 * "We already have your message" for an order that actually expired leaves
 * them waiting for goods that are back on sale.
 */
describe('declarePaid', () => {
  beforeEach(resetDb)

  it('tells a buyer whose order the sweep already released that it expired', async () => {
    const { declarePaid } = await import('@/app/pay/[token]/actions')
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date(Date.now() - 60_000) })

    // The sweep nulls holdExpiresAt, so only the order's status still records
    // the lapse — this is the case that used to read as reassurance.
    await releaseExpiredHolds()

    expect(await declarePaid(null, form(order.token))).toBe(EXPIRED_MESSAGE)
  })

  it('tells a buyer whose hold lapsed but has not been swept the same thing', async () => {
    const { declarePaid } = await import('@/app/pay/[token]/actions')
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date(Date.now() - 60_000) })

    expect(await declarePaid(null, form(order.token))).toBe(EXPIRED_MESSAGE)
  })

  it('still reassures the buyer who taps twice, who did nothing wrong', async () => {
    const { declarePaid } = await import('@/app/pay/[token]/actions')
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date(Date.now() + 600_000) })

    expect(await declarePaid(null, form(order.token))).toBeNull()
    expect(await declarePaid(null, form(order.token))).toBe(ALREADY_MESSAGE)
  })

  it('reassures the buyer whose payment the seller has already confirmed', async () => {
    const { declarePaid } = await import('@/app/pay/[token]/actions')
    const item = await makeItem({ status: ItemStatus.SOLD })
    const order = await makeOrder([item.id], { status: OrderStatus.PAID, holdExpiresAt: null })

    expect(await declarePaid(null, form(order.token))).toBe(ALREADY_MESSAGE)
  })

  it('reports an unknown token', async () => {
    const { declarePaid } = await import('@/app/pay/[token]/actions')
    expect(await declarePaid(null, form('nope'))).toBe('לא מצאנו את ההזמנה.')
  })
})
