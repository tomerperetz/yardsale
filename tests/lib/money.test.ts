import { describe, it, expect } from 'vitest'
import { formatAgorot, shekelsToAgorot, parseShekelInput } from '@/lib/money'

describe('formatAgorot', () => {
  it('formats whole shekels without decimals', () => {
    expect(formatAgorot(85000)).toBe('₪850')
  })

  it('groups thousands', () => {
    expect(formatAgorot(168000)).toBe('₪1,680')
  })

  it('formats zero', () => {
    expect(formatAgorot(0)).toBe('₪0')
  })

  it('rounds agorot to the nearest shekel', () => {
    expect(formatAgorot(85050)).toBe('₪851')
  })
})

describe('shekelsToAgorot', () => {
  it('multiplies by 100', () => {
    expect(shekelsToAgorot(850)).toBe(85000)
  })

  it('never produces a float', () => {
    expect(Number.isInteger(shekelsToAgorot(19.99))).toBe(true)
    expect(shekelsToAgorot(19.99)).toBe(1999)
  })
})

describe('parseShekelInput', () => {
  it('parses a plain number', () => {
    expect(parseShekelInput('850')).toBe(85000)
  })

  it('ignores a shekel sign and commas', () => {
    expect(parseShekelInput('₪1,680')).toBe(168000)
  })

  it('rejects a negative price', () => {
    expect(parseShekelInput('-5')).toBeNull()
  })

  it('rejects nonsense', () => {
    expect(parseShekelInput('abc')).toBeNull()
    expect(parseShekelInput('')).toBeNull()
  })
})
