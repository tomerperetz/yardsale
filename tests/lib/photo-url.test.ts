import { describe, it, expect } from 'vitest'
import { MAX_PHOTOS_PER_ITEM, WIDTHS, photoFilename, photoUrl } from '@/lib/photo-url'

describe('photoFilename', () => {
  it('names a file by width alone, since the photo id is the directory', () => {
    expect(photoFilename(400)).toBe('400.webp')
    expect(photoFilename(1600)).toBe('1600.webp')
  })

  it('produces only names the serving route accepts', () => {
    // src/app/img/[photoId]/[file]/route.ts validates the filename before
    // touching the filesystem; a name it rejects is a silent 404.
    for (const w of WIDTHS) {
      expect(photoFilename(w)).toMatch(/^\d+\.webp$/)
    }
  })
})

describe('photoUrl', () => {
  it('addresses a photo without reference to any item', () => {
    expect(photoUrl('abc123')).toBe('/img/abc123/400.webp')
    expect(photoUrl('abc123', 800)).toBe('/img/abc123/800.webp')
  })

  it('defaults to the smallest width', () => {
    expect(photoUrl('abc123')).toBe(photoUrl('abc123', 400))
  })

  it('builds the same filename the stored file uses', () => {
    for (const w of WIDTHS) {
      expect(photoUrl('abc123', w)).toBe(`/img/abc123/${photoFilename(w)}`)
    }
  })
})

describe('upload limits', () => {
  it('keeps the limits the seller sees and the server enforces in one place', () => {
    expect(WIDTHS).toEqual([400, 800, 1600])
    expect(MAX_PHOTOS_PER_ITEM).toBe(10)
  })
})
