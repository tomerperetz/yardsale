import { describe, it, expect } from 'vitest'
import { MAX_PHOTOS_PER_ITEM, WIDTHS, photoFilename, photoUrl } from '@/lib/photo-url'

describe('photoUrl', () => {
  it('addresses the 400px variant by default — the thumbnail size', () => {
    expect(photoUrl('item1', 'photo1')).toBe('/img/item1/photo1-400.webp')
  })

  it('addresses an explicit width', () => {
    expect(photoUrl('item1', 'photo1', 1600)).toBe('/img/item1/photo1-1600.webp')
  })

  it('builds the same filename the stored file uses', () => {
    for (const w of WIDTHS) {
      expect(photoUrl('item1', 'photo1', w)).toBe(`/img/item1/${photoFilename('photo1', w)}`)
    }
  })

  it('produces only characters the serving route accepts', () => {
    // src/app/img/[itemId]/[file]/route.ts validates the filename before
    // touching the filesystem; a name it rejects is a silent 404.
    for (const w of WIDTHS) {
      expect(photoFilename('abc123', w)).toMatch(/^[a-z0-9]+-\d+\.webp$/)
    }
  })

  it('keeps the limits the seller sees and the server enforces in one place', () => {
    expect(WIDTHS).toEqual([400, 800, 1600])
    expect(MAX_PHOTOS_PER_ITEM).toBe(10)
  })
})
