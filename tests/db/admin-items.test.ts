import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder } from '../helpers/factories'
import { createItem, openDraft, updateItem, deleteItem, normalizeCategoryName } from '@/lib/admin/items'
import { DRAFT_NAME } from '@/lib/admin/draft'

const valid = {
  name: 'ספה תלת מושבית',
  description: 'בד אפור, נקייה מאוד.',
  price: '850',
  categoryName: 'ריהוט',
  pickupFrom: '2026-09-12',
  pickupTo: '2026-09-18',
  photoIds: [],
  publish: true,
}

describe('normalizeCategoryName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeCategoryName('  ריהוט   לבית ')).toBe('ריהוט לבית')
  })
})

describe('createItem', () => {
  beforeEach(resetDb)

  it('creates a published item with a hebrew slug', async () => {
    const r = await createItem(valid)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.slug.startsWith('ספה-תלת-מושבית-')).toBe(true)

    const item = await db.item.findUniqueOrThrow({ where: { id: r.id } })
    expect(item.status).toBe(ItemStatus.AVAILABLE)
    expect(item.priceAgorot).toBe(85000)
  })

  it('leaves an unpublished item as a draft', async () => {
    const r = await createItem({ ...valid, publish: false })
    if (!r.ok) throw new Error('expected ok')
    expect((await db.item.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(ItemStatus.DRAFT)
  })

  it('creates the category the first time it is typed', async () => {
    await createItem(valid)
    expect(await db.category.count({ where: { name: 'ריהוט' } })).toBe(1)
  })

  it('reuses an existing category rather than duplicating it', async () => {
    await createItem(valid)
    await createItem({ ...valid, name: 'כיסא', categoryName: '  ריהוט  ' })
    expect(await db.category.count()).toBe(1)
  })

  it('gives two items with the same name distinct slugs', async () => {
    const a = await createItem(valid)
    const b = await createItem(valid)
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(a.slug).not.toBe(b.slug)
  })

  it('rejects a price that is not a number', async () => {
    expect(await createItem({ ...valid, price: 'בערך 800' })).toEqual({ ok: false, error: 'מחיר לא תקין.' })
  })

  it('rejects an empty name', async () => {
    expect(await createItem({ ...valid, name: '  ' })).toEqual({ ok: false, error: 'צריך שם לפריט.' })
  })

  it('rejects an empty category', async () => {
    expect(await createItem({ ...valid, categoryName: '' })).toEqual({ ok: false, error: 'צריך לבחור קטגוריה.' })
  })

  it('rejects a pickup window that ends before it starts', async () => {
    expect(await createItem({ ...valid, pickupFrom: '2026-09-18', pickupTo: '2026-09-12' }))
      .toEqual({ ok: false, error: 'חלון האיסוף מסתיים לפני שהוא מתחיל.' })
  })

  it('accepts a single-day pickup window', async () => {
    expect((await createItem({ ...valid, pickupFrom: '2026-09-12', pickupTo: '2026-09-12' })).ok).toBe(true)
  })
})

describe('deleteItem', () => {
  beforeEach(resetDb)

  it('deletes an available item and its photo rows', async () => {
    const r = await createItem(valid)
    if (!r.ok) throw new Error('expected ok')
    await db.photo.create({ data: { itemId: r.id, width: 800, height: 600, lqip: 'x', position: 0 } })

    expect(await deleteItem(r.id)).toEqual({ ok: true })
    expect(await db.item.findUnique({ where: { id: r.id } })).toBeNull()
    expect(await db.photo.count({ where: { itemId: r.id } })).toBe(0)
  })

  it('refuses to delete an item that belongs to an order', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    await makeOrder([item.id])

    expect(await deleteItem(item.id)).toEqual({ ok: false, error: 'אי אפשר למחוק פריט ששייך להזמנה.' })
    expect(await db.item.findUnique({ where: { id: item.id } })).not.toBeNull()
  })
})

describe('updateItem slug behaviour', () => {
  beforeEach(resetDb)

  it('regenerates the slug when a draft is renamed', async () => {
    const created = await createItem({ ...valid, name: 'שם זמני', publish: false })
    if (!created.ok) throw new Error('expected ok')

    const updated = await updateItem(created.id, { ...valid, name: 'ספה חדשה', publish: false })
    if (!updated.ok) throw new Error('expected ok')

    expect(updated.slug.startsWith('ספה-חדשה-')).toBe(true)
    expect(updated.slug).not.toBe(created.slug)
  })

  it('freezes the slug once an item has been published', async () => {
    const created = await createItem(valid) // valid.publish is true
    if (!created.ok) throw new Error('expected ok')

    const updated = await updateItem(created.id, { ...valid, name: 'שם אחר לגמרי', publish: true })
    if (!updated.ok) throw new Error('expected ok')

    expect(updated.slug).toBe(created.slug)
  })
})

describe('openDraft', () => {
  beforeEach(resetDb)

  const blank = { ...valid, name: DRAFT_NAME, description: '', price: '0', publish: false }

  it('reuses an untouched draft instead of leaving one behind per visit', async () => {
    const first = await openDraft(blank)
    const second = await openDraft(blank)
    const third = await openDraft(blank)
    if (!first.ok || !second.ok || !third.ok) throw new Error('expected ok')

    expect(second.id).toBe(first.id)
    expect(third.id).toBe(first.id)
    expect(await db.item.count({ where: { status: ItemStatus.DRAFT } })).toBe(1)
  })

  it('leaves a draft alone once a photo has landed on it', async () => {
    const first = await openDraft(blank)
    if (!first.ok) throw new Error('expected ok')
    await db.photo.create({ data: { itemId: first.id, width: 800, height: 600, lqip: 'x', position: 0 } })

    const second = await openDraft(blank)
    if (!second.ok) throw new Error('expected ok')
    expect(second.id).not.toBe(first.id)
    expect(await db.item.count({ where: { status: ItemStatus.DRAFT } })).toBe(2)
  })

  it('leaves a draft alone once the seller has named it', async () => {
    const first = await openDraft(blank)
    if (!first.ok) throw new Error('expected ok')
    await updateItem(first.id, { ...valid, name: 'ספה שהתחלתי', publish: false })

    const second = await openDraft(blank)
    if (!second.ok) throw new Error('expected ok')
    expect(second.id).not.toBe(first.id)
  })

  it('never reuses a published item that happens to carry the draft name', async () => {
    const published = await createItem({ ...valid, name: DRAFT_NAME })
    if (!published.ok) throw new Error('expected ok')

    const draft = await openDraft(blank)
    if (!draft.ok) throw new Error('expected ok')
    expect(draft.id).not.toBe(published.id)
  })
})
