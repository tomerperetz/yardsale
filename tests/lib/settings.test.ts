import { describe, it, expect } from 'vitest'
import { shopIsOpen, missingSettings } from '@/lib/settings'

const empty = {
  id: 1, shopName: '', tagline: '', bitPhone: '', addressLine: '', city: '',
  slotMorning: '', slotAfternoon: '', slotEvening: '', holdMinutes: 15, dismissedMerges: [],
}

describe('shopIsOpen', () => {
  it('is closed while the BIT number is unset', () => {
    expect(shopIsOpen({ bitPhone: '' })).toBe(false)
    expect(shopIsOpen({ bitPhone: '   ' })).toBe(false)
  })

  it('is open once a BIT number exists', () => {
    expect(shopIsOpen({ bitPhone: '0501234567' })).toBe(true)
  })
})

describe('missingSettings', () => {
  it('lists every unset seller field', () => {
    expect(missingSettings(empty)).toEqual(['shopName', 'bitPhone', 'addressLine', 'city'])
  })

  it('drops fields once they are filled', () => {
    expect(missingSettings({ ...empty, shopName: 'x', bitPhone: 'y' })).toEqual(['addressLine', 'city'])
  })

  it('does not consider the tagline required', () => {
    expect(missingSettings({ ...empty, shopName: 'a', bitPhone: 'b', addressLine: 'c', city: 'd' })).toEqual([])
  })
})
