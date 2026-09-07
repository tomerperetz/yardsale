import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { sniffImageType, storePhoto, deletePhotoFiles, photoDir, photoFilename, WIDTHS } from '@/lib/images'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ys-'))
  process.env.UPLOAD_DIR = dir
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const jpeg = () => sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#888' } }).jpeg().toBuffer()

describe('sniffImageType', () => {
  it('recognises jpeg by magic bytes', async () => {
    expect(sniffImageType(await jpeg())).toBe('jpeg')
  })

  it('recognises png', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer()
    expect(sniffImageType(png)).toBe('png')
  })

  it('recognises webp', async () => {
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).webp().toBuffer()
    expect(sniffImageType(webp)).toBe('webp')
  })

  it('rejects a file that merely claims to be an image', () => {
    expect(sniffImageType(Buffer.from('<?php echo 1; ?>'))).toBeNull()
  })
})

describe('photoDir', () => {
  it('gives a photo its own directory, named by the photo alone', () => {
    expect(photoDir('photo1')).toBe(path.join(dir, 'photo1'))
  })
})

describe('storePhoto', () => {
  it("writes one webp per width, in the photo's own directory", async () => {
    await storePhoto(await jpeg(), 'photo1')
    const files = await readdir(path.join(dir, 'photo1'))
    expect(files.sort()).toEqual(WIDTHS.map((w) => photoFilename(w)).sort())
  })

  it('returns the original dimensions', async () => {
    const r = await storePhoto(await jpeg(), 'photo1')
    expect(r.width).toBe(2400)
    expect(r.height).toBe(1800)
  })

  it('returns a data-uri blur placeholder', async () => {
    const r = await storePhoto(await jpeg(), 'photo1')
    expect(r.lqip.startsWith('data:image/webp;base64,')).toBe(true)
    expect(r.lqip.length).toBeLessThan(2000)
  })

  it('never upscales a small original', async () => {
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#000' } }).jpeg().toBuffer()
    await storePhoto(small, 'photo2')
    const meta = await sharp(path.join(dir, 'photo2', photoFilename(1600))).metadata()
    expect(meta.width).toBe(300)
  })

  it('strips exif, including GPS', async () => {
    const withExif = await sharp(await jpeg()).withExif({ IFD0: { Copyright: 'x' } }).toBuffer()
    await storePhoto(withExif, 'photo3')
    const meta = await sharp(path.join(dir, 'photo3', photoFilename(800))).metadata()
    expect(meta.exif).toBeUndefined()
  })

  it('cleans up after itself when the image cannot be decoded', async () => {
    // Valid PNG magic bytes followed by garbage: sniffs as 'png' but sharp
    // cannot decode it, so this fails deterministically.
    const truncated = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('not a real png')])

    await expect(storePhoto(truncated, 'photo4')).rejects.toThrow()

    const files = await readdir(path.join(dir, 'photo4'))
    expect(files).toEqual([])
  })
})

describe('deletePhotoFiles', () => {
  it('removes every width variant of a stored photo', async () => {
    await storePhoto(await jpeg(), 'photo5')
    const before = await readdir(path.join(dir, 'photo5'))
    expect(before.sort()).toEqual(WIDTHS.map((w) => photoFilename(w)).sort())

    await deletePhotoFiles('photo5')
    expect(await readdir(dir)).toEqual([])
  })

  it('leaves other photos alone', async () => {
    await storePhoto(await jpeg(), 'photo6')
    await storePhoto(await jpeg(), 'photo7')

    await deletePhotoFiles('photo6')

    expect(await readdir(dir)).toEqual(['photo7'])
  })

  it('resolves rather than throwing when there is nothing to remove', async () => {
    await expect(deletePhotoFiles('photo5')).resolves.toBeUndefined()
  })
})
