'use client'

import { useActionState, useState } from 'react'
import { checkout, type CheckoutState } from '@/app/checkout/actions'
import { PickupPicker, type PickupPickerItem, type PickupSlotValue } from '@/components/PickupPicker'

const initialState: CheckoutState = {}

/**
 * The interactive half of the checkout screen — name/phone fields, the
 * pickup picker, and the submit button. Split out from `checkout/page.tsx`
 * (a server component that does the data fetching) because `useActionState`
 * and the day/slot selection state both need a client component.
 *
 * Client-side validation is deliberately light (native `type` hints only):
 * `checkout/actions.ts` re-checks everything server-side regardless of what
 * this form sends, so there's no point duplicating it here.
 */
export function CheckoutForm({
  itemIds,
  pickupItems,
  intersection,
}: {
  itemIds: string[]
  pickupItems: PickupPickerItem[]
  intersection: { from: Date; to: Date; startItemId: string; endItemId: string }
}) {
  const [state, formAction, isPending] = useActionState(checkout, initialState)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<PickupSlotValue | null>(null)

  return (
    <form action={formAction}>
      <input type="hidden" name="itemIds" value={itemIds.join(',')} />
      <input type="hidden" name="pickupDate" value={selectedDate ?? ''} />
      <input type="hidden" name="pickupSlot" value={selectedSlot ?? ''} />

      {state.error && <p className="checkout-error">{state.error}</p>}

      <div className="sect">
        <label className="lbl" htmlFor="buyerName">
          שם מלא
        </label>
        <input className="fld" id="buyerName" name="buyerName" type="text" autoComplete="name" />
      </div>

      <div className="sect">
        <label className="lbl" htmlFor="buyerPhone">
          טלפון
        </label>
        <input
          className="fld fld-phone"
          id="buyerPhone"
          name="buyerPhone"
          type="tel"
          dir="ltr"
          autoComplete="tel"
        />
      </div>

      <PickupPicker
        items={pickupItems}
        intersection={intersection}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        selectedSlot={selectedSlot}
        onSelectSlot={setSelectedSlot}
      />

      <div className="foot-btn">
        <button type="submit" className="btn-primary" disabled={isPending || !selectedDate || !selectedSlot}>
          שריון הפריטים והמשך
        </button>
      </div>
    </form>
  )
}
