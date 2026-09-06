import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs typescript under vitest', () => {
    const answer: number = 40 + 2
    expect(answer).toBe(42)
  })
})
