import { describe, it, expect } from 'vitest'
import { groupByCaptureTime } from '@/lib/exif'

const at = (iso: string) => new Date(iso)

describe('groupByCaptureTime', () => {
  it('groups photos taken within thirty seconds', () => {
    const groups = groupByCaptureTime([
      { key: 'a', takenAt: at('2026-09-06T10:00:00Z'), lastModified: null },
      { key: 'b', takenAt: at('2026-09-06T10:00:20Z'), lastModified: null },
      { key: 'c', takenAt: at('2026-09-06T10:00:30Z'), lastModified: null },
    ])
    expect(groups).toEqual([['a', 'b', 'c']])
  })

  it('splits at thirty-one seconds', () => {
    const groups = groupByCaptureTime([
      { key: 'a', takenAt: at('2026-09-06T10:00:00Z'), lastModified: null },
      { key: 'b', takenAt: at('2026-09-06T10:00:31Z'), lastModified: null },
    ])
    expect(groups).toEqual([['a'], ['b']])
  })

  it('measures the gap between neighbours, not from the group start', () => {
    const groups = groupByCaptureTime([
      { key: 'a', takenAt: at('2026-09-06T10:00:00Z'), lastModified: null },
      { key: 'b', takenAt: at('2026-09-06T10:00:25Z'), lastModified: null },
      { key: 'c', takenAt: at('2026-09-06T10:00:50Z'), lastModified: null },
    ])
    expect(groups).toEqual([['a', 'b', 'c']])
  })

  it('sorts by capture time regardless of input order', () => {
    const groups = groupByCaptureTime([
      { key: 'late', takenAt: at('2026-09-06T11:00:00Z'), lastModified: null },
      { key: 'early', takenAt: at('2026-09-06T10:00:00Z'), lastModified: null },
    ])
    expect(groups).toEqual([['early'], ['late']])
  })

  it('falls back to lastModified when exif is missing', () => {
    const groups = groupByCaptureTime([
      { key: 'a', takenAt: null, lastModified: Date.parse('2026-09-06T10:00:00Z') },
      { key: 'b', takenAt: null, lastModified: Date.parse('2026-09-06T10:00:10Z') },
    ])
    expect(groups).toEqual([['a', 'b']])
  })

  it('gives a photo with no timestamp at all its own group', () => {
    const groups = groupByCaptureTime([
      { key: 'a', takenAt: at('2026-09-06T10:00:00Z'), lastModified: null },
      { key: 'x', takenAt: null, lastModified: null },
      { key: 'y', takenAt: null, lastModified: null },
    ])
    expect(groups).toEqual([['a'], ['x'], ['y']])
  })

  it('honours a custom gap', () => {
    const groups = groupByCaptureTime(
      [
        { key: 'a', takenAt: at('2026-09-06T10:00:00Z'), lastModified: null },
        { key: 'b', takenAt: at('2026-09-06T10:00:45Z'), lastModified: null },
      ],
      60,
    )
    expect(groups).toEqual([['a', 'b']])
  })

  it('returns nothing for no photos', () => {
    expect(groupByCaptureTime([])).toEqual([])
  })
})
