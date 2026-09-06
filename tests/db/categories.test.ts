import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeCategory, makeItem } from '../helpers/factories'
import { mergeCategories, renameCategory } from '@/lib/admin/categories'

describe('mergeCategories', () => {
  beforeEach(resetDb)

  it('moves every item and deletes the emptied category', async () => {
    const from = await makeCategory('ריהוט לבית')
    const into = await makeCategory('ריהוט')
    await makeItem({ categoryId: from.id })
    await makeItem({ categoryId: from.id })

    await mergeCategories(from.id, into.id)

    expect(await db.item.count({ where: { categoryId: into.id } })).toBe(2)
    expect(await db.category.findUnique({ where: { id: from.id } })).toBeNull()
  })

  // Without the guard this deletes a category its own items still point at:
  // a foreign-key violation surfacing as an unhandled 500.
  it('refuses to merge a category into itself, in words rather than a crash', async () => {
    const c = await makeCategory('ריהוט')
    await makeItem({ categoryId: c.id })

    expect(await mergeCategories(c.id, c.id)).toEqual({
      ok: false,
      error: 'אי אפשר למזג קטגוריה לתוך עצמה.',
    })

    expect(await db.category.findUnique({ where: { id: c.id } })).not.toBeNull()
    expect(await db.item.count({ where: { categoryId: c.id } })).toBe(1)
  })
})

describe('renameCategory', () => {
  beforeEach(resetDb)

  it('renames', async () => {
    const c = await makeCategory('ריהו')
    expect(await renameCategory(c.id, 'ריהוט')).toEqual({ ok: true })
    expect((await db.category.findUniqueOrThrow({ where: { id: c.id } })).name).toBe('ריהוט')
  })

  it('refuses a name that already exists', async () => {
    await makeCategory('ריהוט')
    const other = await makeCategory('מטבח')
    expect(await renameCategory(other.id, 'ריהוט')).toEqual({ ok: false, error: 'כבר קיימת קטגוריה בשם הזה.' })
  })

  it('refuses an empty name', async () => {
    const c = await makeCategory('מטבח')
    expect(await renameCategory(c.id, '   ')).toEqual({ ok: false, error: 'צריך שם לקטגוריה.' })
  })
})
