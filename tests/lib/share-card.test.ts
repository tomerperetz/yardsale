import { describe, it, expect, afterEach } from 'vitest'
import { shareCard } from '@/lib/share-card'
import { siteUrl } from '@/lib/site-url'

const photo = { id: 'abc123', width: 4032, height: 3024 }

/** The og:image entries, whatever shape the metadata came back in. */
const images = (meta: ReturnType<typeof shareCard>) =>
  (meta.openGraph?.images ?? []) as { url: string; width: number; height: number; alt: string }[]

/** Next's Twitter metadata type is a union whose `card` is only on some arms. */
const twitterCard = (meta: ReturnType<typeof shareCard>) => (meta.twitter as { card?: string } | undefined)?.card

describe('shareCard', () => {
  it('carries the title, the sentence and the photo into the Open Graph block', () => {
    const meta = shareCard({ title: 'ספה', description: 'נוחה.', photo, path: '/item/sofa' })

    expect(meta.openGraph?.title).toBe('ספה')
    expect(meta.openGraph?.description).toBe('נוחה.')
    expect(meta.openGraph?.url).toBe('/item/sofa')
    expect(images(meta)[0].url).toBe('/img/abc123/800.webp')
  })

  it('declares the size of the file it points at, not the size on the row', () => {
    // The row records the original; the URL serves it scaled to 800. Telling
    // WhatsApp a 4032×3024 image is coming and handing it an 800×600 one is
    // how a preview ends up cropped.
    const meta = shareCard({ title: 'ס', description: 'ד', photo, path: '/' })
    expect(images(meta)[0]).toMatchObject({ width: 800, height: 600 })
  })

  it('does not enlarge a photograph that was already smaller than the share width', () => {
    // sharp stores it `withoutEnlargement`, so the file really is 500 wide.
    const meta = shareCard({ title: 'ס', description: 'ד', photo: { id: 'x', width: 500, height: 400 }, path: '/' })
    expect(images(meta)[0]).toMatchObject({ width: 500, height: 400 })
  })

  it('omits the image entirely when there is no photograph', () => {
    // An og:image pointing at nothing makes WhatsApp render a broken card,
    // which is worse than the plain link it would otherwise show.
    const meta = shareCard({ title: 'ס', description: 'ד', photo: null, path: '/' })
    expect(meta.openGraph).not.toHaveProperty('images')
    expect(twitterCard(meta)).toBe('summary')
  })

  it('asks for the large card only when it has an image to fill it', () => {
    expect(twitterCard(shareCard({ title: 'ס', description: 'ד', photo, path: '/' }))).toBe('summary_large_image')
  })

  it('says the page is Hebrew, so a preview is not laid out left to right', () => {
    expect(shareCard({ title: 'ס', description: 'ד', photo, path: '/' }).openGraph?.locale).toBe('he_IL')
  })
})

describe('siteUrl', () => {
  afterEach(() => {
    delete process.env.SITE_URL
    delete process.env.RAILWAY_PUBLIC_DOMAIN
  })

  it('prefers the seller’s own domain over the platform’s', () => {
    process.env.SITE_URL = 'https://hatzer.co.il'
    process.env.RAILWAY_PUBLIC_DOMAIN = 'yardsale.up.railway.app'
    expect(siteUrl()?.origin).toBe('https://hatzer.co.il')
  })

  it('works with nothing configured but the platform’s domain, which is the deployed case', () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'yardsale.up.railway.app'
    expect(siteUrl()?.origin).toBe('https://yardsale.up.railway.app')
  })

  it('accepts a bare domain in SITE_URL and makes it https', () => {
    process.env.SITE_URL = 'hatzer.co.il'
    expect(siteUrl()?.origin).toBe('https://hatzer.co.il')
  })

  it('is undefined in development, where there is nothing to preview from', () => {
    expect(siteUrl()).toBeUndefined()
  })

  it('treats an unparseable value as unset rather than throwing on every page', () => {
    process.env.SITE_URL = 'http://['
    expect(() => siteUrl()).not.toThrow()
    expect(siteUrl()).toBeUndefined()
  })
})
