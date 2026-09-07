import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'

describe('an uploaded photo before it has a product', () => {
  beforeEach(resetDb)

  it('can exist with no item, carrying only its batch', async () => {
    const photo = await db.photo.create({
      data: { importBatchId: 'batch-1', width: 800, height: 600, lqip: 'x', position: 0 },
    })
    expect(photo.itemId).toBeNull()
    expect(photo.importBatchId).toBe('batch-1')
  })

  it('finds every photo of a batch', async () => {
    for (let i = 0; i < 3; i++) {
      await db.photo.create({ data: { importBatchId: 'b', width: 8, height: 6, lqip: 'x', position: i } })
    }
    expect(await db.photo.count({ where: { importBatchId: 'b' } })).toBe(3)
  })
})
