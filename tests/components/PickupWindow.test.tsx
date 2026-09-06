// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PickupWindow } from '@/components/PickupWindow'
import { utcDate } from '@/lib/dates'

describe('PickupWindow', () => {
  it('renders a same-month range with the month name, keeping the numbers in an ltr isolate', () => {
    const { container } = render(<PickupWindow from={utcDate(2026, 9, 12)} to={utcDate(2026, 9, 18)} />)
    expect(container.textContent).toBe('12–18 בספטמבר')
    const isolate = container.querySelector('span[dir="ltr"]')
    expect(isolate?.textContent).toBe('12–18')
  })

  it('renders a single pickup day with no range', () => {
    const { container } = render(<PickupWindow from={utcDate(2026, 9, 15)} to={utcDate(2026, 9, 15)} />)
    expect(container.textContent).toBe('15 בספטמבר')
  })

  it('renders each day beside its own month name across a month boundary, with no isolate', () => {
    const { container } = render(<PickupWindow from={utcDate(2026, 9, 28)} to={utcDate(2026, 10, 3)} />)
    expect(container.textContent).toBe('28 בספטמבר – 3 באוקטובר')
    expect(container.querySelector('span[dir="ltr"]')).toBeNull()
  })
})
