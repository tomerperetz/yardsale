import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { seed } from '../../prisma/seed'

describe('seed', () => {
  beforeEach(resetDb)

  it('creates exactly one settings row', async () => {
    await seed()
    const rows = await db.settings.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(1)
  })

  it('leaves every seller-facing field empty', async () => {
    await seed()
    const s = await db.settings.findFirstOrThrow()
    expect(s.shopName).toBe('')
    expect(s.tagline).toBe('')
    expect(s.bitPhone).toBe('')
    expect(s.addressLine).toBe('')
    expect(s.city).toBe('')
  })

  it('defaults the hold to 15 minutes', async () => {
    await seed()
    const s = await db.settings.findFirstOrThrow()
    expect(s.holdMinutes).toBe(15)
  })

  it('is idempotent', async () => {
    await seed()
    await seed()
    expect(await db.settings.count()).toBe(1)
  })

  it('creates no items', async () => {
    await seed()
    expect(await db.item.count()).toBe(0)
  })
})
