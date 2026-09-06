'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { checkout, type CheckoutState } from '@/app/checkout/actions'
import { useCart } from '@/components/CartProvider'
import { PickupPicker, type PickupPickerItem, type PickupSlotValue, type SlotHours } from '@/components/PickupPicker'

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
  slotHours,
}: {
  itemIds: string[]
  pickupItems: PickupPickerItem[]
  intersection: { from: Date; to: Date; startItemId: string; endItemId: string }
  slotHours: SlotHours
}) {
  const router = useRouter()
  const cart = useCart()
  const [state, formAction, isPending] = useActionState(checkout, initialState)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<PickupSlotValue | null>(null)

  const unavailableIds = state.unavailableItemIds ?? []
  const unavailableNames = unavailableIds.map((id) => pickupItems.find((item) => item.id === id)?.name ?? id)
  const remainingAfterUnavailable = itemIds.filter((id) => !unavailableIds.includes(id))

  const continueWithoutUnavailable = () => {
    for (const id of unavailableIds) cart.remove(id)
    if (remainingAfterUnavailable.length > 0) {
      router.push(`/checkout?items=${remainingAfterUnavailable.join(',')}`)
    } else {
      router.push('/')
    }
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="itemIds" value={itemIds.join(',')} />
      <input type="hidden" name="pickupDate" value={selectedDate ?? ''} />
      <input type="hidden" name="pickupSlot" value={selectedSlot ?? ''} />

      {state.error && (
        <div className="checkout-error">
          <p>{state.error}</p>
          {unavailableIds.length > 0 && (
            <>
              <ul className="unavailable-list">
                {unavailableNames.map((name, i) => (
                  <li key={unavailableIds[i]}>{name}</li>
                ))}
              </ul>
              {remainingAfterUnavailable.length > 0 ? (
                <button type="button" className="btn-primary" onClick={continueWithoutUnavailable}>
                  הסרת הפריטים שנמכרו והמשך
                </button>
              ) : (
                <p className="unavailable-empty">
                  כל הפריטים שבחרתם כבר לא זמינים. <Link href="/">חזרה לחנות</Link>
                </p>
              )}
            </>
          )}
        </div>
      )}

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
        slotHours={slotHours}
      />

      <div className="foot-btn">
        <button type="submit" className="btn-primary" disabled={isPending || !selectedDate || !selectedSlot}>
          שריון הפריטים והמשך
        </button>
      </div>
    </form>
  )
}
