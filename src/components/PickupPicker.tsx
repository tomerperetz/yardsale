'use client'

import { eachDay } from '@/lib/dates'
import { PickupWindow } from '@/components/PickupWindow'

export type PickupSlotValue = 'MORNING' | 'AFTERNOON' | 'EVENING'
export type PickupPickerItem = { id: string; name: string; from: Date; to: Date }
/** The seller's free-text hour range per slot, e.g. `{ AFTERNOON: '12:00–17:00' }` — from `Settings`, may be empty. */
export type SlotHours = Record<PickupSlotValue, string>

const WEEKDAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

const SLOTS: { value: PickupSlotValue; label: string }[] = [
  { value: 'MORNING', label: 'בוקר' },
  { value: 'AFTERNOON', label: 'אחה״צ' },
  { value: 'EVENING', label: 'ערב' },
]

/** `@db.Date` columns land as UTC midnight — slicing the ISO string keeps the calendar day exact. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Each item in the cart carries its own pickup window; the buyer picks one
 * day for the whole order. The day strip spans the UNION of every item's
 * window (so a buyer can see *why* the edges are closed), while only days
 * inside the cart's shared INTERSECTION are selectable — the rest render
 * disabled and struck through, per the accessible-names contract (they
 * stay real `<button disabled>` elements, never spans).
 *
 * Styling lifted from docs/design/mockups/02-buyer-flow.html, panel 2
 * ("פרטים ואיסוף").
 */
export function PickupPicker({
  items,
  intersection,
  selectedDate,
  onSelectDate,
  selectedSlot,
  onSelectSlot,
  slotHours,
}: {
  items: PickupPickerItem[]
  intersection: { from: Date; to: Date; startItemId: string; endItemId: string }
  selectedDate: string | null
  onSelectDate: (iso: string) => void
  selectedSlot: PickupSlotValue | null
  onSelectSlot: (slot: PickupSlotValue) => void
  slotHours: SlotHours
}) {
  const displayFrom = new Date(Math.min(...items.map((item) => item.from.getTime())))
  const displayTo = new Date(Math.max(...items.map((item) => item.to.getTime())))
  const days = eachDay(displayFrom, displayTo)

  const startItem = items.find((item) => item.id === intersection.startItemId)
  const endItem = items.find((item) => item.id === intersection.endItemId)
  const sameBound = intersection.startItemId === intersection.endItemId

  return (
    <div className="sect">
      <div className="lbl">יום איסוף</div>

      {items.length > 1 && startItem && endItem && (
        <div className="window-note">
          {items.length} פריטים בהזמנה חופפים רק בין{' '}
          <b>
            <PickupWindow from={intersection.from} to={intersection.to} />
          </b>
          {sameBound ? (
            <> — נקבע לפי הזמינות של &quot;{startItem.name}&quot;.</>
          ) : (
            <>
              {' '}
              — נקבע לפי הזמינות של &quot;{startItem.name}&quot; ו&quot;{endItem.name}&quot;.
            </>
          )}
        </div>
      )}

      <div className="days">
        {days.map((day) => {
          const iso = isoDate(day)
          const enabled = day.getTime() >= intersection.from.getTime() && day.getTime() <= intersection.to.getTime()
          const on = enabled && selectedDate === iso
          return (
            <button
              key={iso}
              type="button"
              className={on ? 'day on' : enabled ? 'day' : 'day off'}
              disabled={!enabled}
              onClick={() => onSelectDate(iso)}
            >
              <small aria-hidden="true">{WEEKDAY_LETTERS[day.getUTCDay()]}</small>
              <b>{day.getUTCDate()}</b>
            </button>
          )
        })}
      </div>

      <div className="slots">
        {SLOTS.map((slot) => {
          const hours = slotHours[slot.value].trim()
          return (
            <button
              key={slot.value}
              type="button"
              className={selectedSlot === slot.value ? 'slot on' : 'slot'}
              onClick={() => onSelectSlot(slot.value)}
            >
              <b>{slot.label}</b>
              {/* The seller's configured hours, when set — shown at the moment the
                  buyer chooses rather than only afterwards on /o/[token]. Substring
                  matching means the bare label (`אחה״צ`) still selects this button;
                  see accessible-names.md for why the day chips can't share that luxury. */}
              {hours !== '' && <small>{hours}</small>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
