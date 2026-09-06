// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Range } from '@/components/Range'

describe('Range', () => {
  it('wraps the range in an ltr isolate', () => {
    const { container } = render(<Range from={12} to={18} />)
    const span = container.querySelector('span')
    expect(span?.getAttribute('dir')).toBe('ltr')
  })

  it('renders from and to in logical order separated by an en dash', () => {
    const { container } = render(<Range from={12} to={18} />)
    expect(container.textContent).toBe('12–18')
  })

  it('accepts strings', () => {
    const { container } = render(<Range from="09:00" to="12:00" />)
    expect(container.textContent).toBe('09:00–12:00')
  })

  it('collapses an identical from and to to a single value', () => {
    const { container } = render(<Range from={15} to={15} />)
    expect(container.textContent).toBe('15')
  })
})
