import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeCategory, makeItem } from '../helpers/factories'

const BATCH = 'batch-under-test'

/**
 * The query behind the "קטגוריה חדשה" flag on the import review screen.
 *
 * It lives in the page component, so this reproduces it exactly rather than
 * importing it. That is a real cost — the two can drift — but the alternative
 * is no coverage at all, and no coverage is how it shipped wrong: the first
 * version compared `importBatchId <> $batch`, and because `NULL <> 'batch'` is
 * NULL rather than true in SQL, every hand-made item failed the inner EXISTS
 * and every long-standing category came back flagged as new.
 */
function newCategoriesOfBatch(batchId: string) {
  return db.category.findMany({
    where: {
      items: { some: { importBatchId: batchId } },
      NOT: {
        items: {
          some: { OR: [{ importBatchId: null }, { importBatchId: { not: batchId } }] },
        },
      },
    },
    select: { name: true },
    orderBy: { name: 'asc' },
  })
}

describe('which categories this import invented', () => {
  beforeEach(resetDb)

  it('flags a category that exists only because of this batch', async () => {
    const category = await makeCategory('כלי גינה')
    const item = await makeItem({ categoryId: category.id, status: ItemStatus.DRAFT })
    await db.item.update({ where: { id: item.id }, data: { importBatchId: BATCH } })

    expect((await newCategoriesOfBatch(BATCH)).map((c) => c.name)).toEqual(['כלי גינה'])
  })

  it('does NOT flag a category the seller already had, added by hand', async () => {
    // The regression. A hand-made item carries importBatchId null, and the
    // first version of this query could not see it — so a seller importing
    // into their years-old ריהוט was told it was brand new, on every card.
    const category = await makeCategory('ריהוט')
    const handMade = await makeItem({ categoryId: category.id })
    expect(handMade.importBatchId).toBeNull()

    const imported = await makeItem({ categoryId: category.id, status: ItemStatus.DRAFT })
    await db.item.update({ where: { id: imported.id }, data: { importBatchId: BATCH } })

    expect(await newCategoriesOfBatch(BATCH)).toEqual([])
  })

  it('does not flag a category shared with an earlier import', async () => {
    const category = await makeCategory('ספרים')
    const older = await makeItem({ categoryId: category.id, status: ItemStatus.DRAFT })
    await db.item.update({ where: { id: older.id }, data: { importBatchId: 'an-earlier-batch' } })

    const mine = await makeItem({ categoryId: category.id, status: ItemStatus.DRAFT })
    await db.item.update({ where: { id: mine.id }, data: { importBatchId: BATCH } })

    expect(await newCategoriesOfBatch(BATCH)).toEqual([])
  })

  it('says nothing about a category this batch never used', async () => {
    const other = await makeCategory('מטבח')
    await makeItem({ categoryId: other.id })

    expect(await newCategoriesOfBatch(BATCH)).toEqual([])
  })

  it('stops flagging once the category earns an item outside the batch', async () => {
    // The flag is computed, not stored, and this is the property that buys:
    // it stops being true exactly when it stops being worth saying.
    const category = await makeCategory('ספורט')
    const imported = await makeItem({ categoryId: category.id, status: ItemStatus.DRAFT })
    await db.item.update({ where: { id: imported.id }, data: { importBatchId: BATCH } })
    expect((await newCategoriesOfBatch(BATCH)).map((c) => c.name)).toEqual(['ספורט'])

    await makeItem({ categoryId: category.id })
    expect(await newCategoriesOfBatch(BATCH)).toEqual([])
  })
})
