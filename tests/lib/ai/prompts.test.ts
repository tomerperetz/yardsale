import { describe, it, expect } from 'vitest'
import {
  CAPTION_SYSTEM,
  CAPTION_USER,
  CLUSTER_SYSTEM,
  CLUSTER_USER,
  captionUser,
  clusterUser,
} from '@/lib/ai/prompts'

/**
 * The prompt texts themselves are validated against a real model (spec §10),
 * not here. What is testable here is the substitution — a placeholder left in
 * or filled wrongly would ship to the model as literal text, and only a human
 * reading the request would ever see it.
 */
describe('clusterUser', () => {
  it('tells the model how many photographs there are and how they are numbered', () => {
    expect(clusterUser(5)).toBe('Here are 5 photographs, numbered 0 to 4 in the order given.\n\nGroup them by object.')
  })

  it('numbers a single photograph 0 to 0', () => {
    expect(clusterUser(1)).toContain('numbered 0 to 0')
  })

  /**
   * `{n}` occurs inside `{n-1}`. Substituting it first leaves `{5-1}` in the
   * prompt — well-formed English, wrong instruction, and invisible in the
   * response.
   */
  it('leaves no placeholder behind', () => {
    expect(clusterUser(12)).not.toContain('{')
  })
})

describe('captionUser', () => {
  it('names the seller categories the model must choose from', () => {
    expect(captionUser(['ריהוט', 'מטבח'])).toContain('Categories to choose from: ריהוט, מטבח')
  })

  it('leaves no placeholder behind when the seller has no categories yet', () => {
    expect(captionUser([])).not.toContain('{')
  })
})

describe('the prompt constants', () => {
  it('carry a placeholder only where one is filled in', () => {
    expect(CLUSTER_SYSTEM).not.toContain('{')
    expect(CAPTION_SYSTEM).not.toContain('{')
    expect(CLUSTER_USER).toContain('{n}')
    expect(CLUSTER_USER).toContain('{n-1}')
    expect(CAPTION_USER).toContain('{categories}')
  })
})
