import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeItem } from '../helpers/factories'
import { generateMetadata } from '@/app/item/[slug]/page'

/**
 * What a shared item link says about itself.
 *
 * A SOLD item still has a page here — this shop keeps sold items in the grid,
 * dimmed — so it still gets a preview card, and the card is where it is easy
 * to lie: a link forwarded into a WhatsApp group two hours after the sofa went
 * previewing as "ספה — ₪450" is an advertisement for something nobody can buy.
 */
const params = (slug: string) => Promise.resolve({ slug })

const title = (meta: Awaited<ReturnType<typeof generateMetadata>>) => String(meta.openGraph?.title ?? '')

describe('an item link’s preview', () => {
  beforeEach(resetDb)

  it('leads with the price while the item is for sale', async () => {
    const item = await makeItem({ priceAgorot: 45_000 })
    expect(title(await generateMetadata({ params: params(item.slug) }))).toContain('450')
  })

  it('says נמכר and drops the price once it has gone', async () => {
    const item = await makeItem({ priceAgorot: 45_000, status: ItemStatus.SOLD })

    const meta = await generateMetadata({ params: params(item.slug) })

    expect(title(meta)).toContain('נמכר')
    expect(title(meta)).not.toContain('450')
    expect(String(meta.openGraph?.description ?? '')).not.toContain('450')
  })

  it('previews a RESERVED item normally — the hold may lapse and it comes back', async () => {
    const item = await makeItem({ priceAgorot: 45_000, status: ItemStatus.RESERVED })
    expect(title(await generateMetadata({ params: params(item.slug) }))).toContain('450')
  })

  it.each([ItemStatus.DRAFT, ItemStatus.HIDDEN])('gives a %s item no card at all', async (status) => {
    // Not public, the page 404s, and the link previews bare.
    const item = await makeItem({ status })
    expect(await generateMetadata({ params: params(item.slug) })).toEqual({})
  })

  it('gives an unknown slug no card, rather than throwing on a bot request', async () => {
    expect(await generateMetadata({ params: params('no-such-item') })).toEqual({})
  })

  it('falls back to the category and price when the seller wrote no description', async () => {
    const item = await makeItem({ priceAgorot: 45_000 })
    await db.item.update({ where: { id: item.id }, data: { description: '' } })

    const meta = await generateMetadata({ params: params(item.slug) })
    expect(String(meta.openGraph?.description ?? '')).toContain('450')
  })
})
