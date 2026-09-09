'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatAgorot } from '@/lib/money'
import { confirmPaymentAction, cancelOrderAction } from './actions'
import styles from './orders.module.css'

type Props = {
  orderId: string
  token: string
  status: 'PENDING_PAYMENT' | 'CLAIMED_PAID' | 'PAID' | 'EXPIRED' | 'CANCELLED'
  buyerName: string
  totalAgorot: number
  /** The order carries a `confirmedAt` stamp — the seller has had this money. */
  paymentConfirmed: boolean
  waHref: string
}

/**
 * The row-level controls: WhatsApp while there is still anything to say to
 * the buyer, plus exactly one status-appropriate action — `אישור תשלום` for a
 * CLAIMED_PAID row, `ביטול` for any order that is still live, or a read-only
 * `פרטים` link once the order is settled. Both buttons go through the same two
 * server actions, which are themselves thin wrappers over
 * src/lib/orders/transitions.ts — no state rule is re-encoded here.
 *
 * `ביטול` is offered on every live row because every live status can reach
 * CANCELLED (src/lib/orders/state.ts), but it does not mean the same thing
 * from each of them, so it does not ask the same question from each of them.
 * From PENDING_PAYMENT or CLAIMED_PAID no money has moved and the items are
 * only on hold: releasing them is cheap and the confirmation is one line.
 * From PAID the seller has been paid and the items are SOLD; cancelling hands
 * those items back to the shop for anyone to buy and leaves a refund this
 * system does not track. That confirmation names the buyer, the amount and
 * both consequences, because nothing else in the app will ever mention them
 * again.
 */
export function OrderRowActions({
  orderId,
  token,
  status,
  buyerName,
  totalAgorot,
  paymentConfirmed,
  waHref,
}: Props) {
  const router = useRouter()
  const [pending, setPending] = useState<'confirm' | 'cancel' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: 'confirm' | 'cancel') {
    setPending(action)
    setError(null)
    const result = action === 'confirm' ? await confirmPaymentAction(orderId) : await cancelOrderAction(orderId)
    setPending(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirming(false)
    router.refresh()
  }

  const isDead = status === 'EXPIRED' || status === 'CANCELLED'
  // Only a PAID order can be cancelled with the money already in: the two
  // other live statuses have never had a confirmation.
  const reversesPayment = status === 'PAID'

  if (confirming) {
    return (
      <div className={styles.actWrap}>
        <div className={reversesPayment ? `${styles.confirm} ${styles.heavy}` : styles.confirm} role="alert">
          {reversesPayment ? (
            <>
              <b>לבטל מכירה שכבר אושרה?</b>
              <span>
                {buyerName} שילמ/ה {formatAgorot(totalAgorot)} ואתם אישרתם את התשלום. ביטול יחזיר את הפריטים
                למכירה בחנות, וכל אחד יוכל לקנות אותם. את ההחזר של {formatAgorot(totalAgorot)} תצטרכו להעביר
                בביט בעצמכם — האתר לא עוקב אחרי החזרים ולא יזכיר לכם שוב.
              </span>
            </>
          ) : (
            <span>לבטל את ההזמנה של {buyerName}? הפריטים יחזרו למכירה בחנות.</span>
          )}
        </div>
        <div className={styles.acts}>
          <button
            type="button"
            className={`${styles.rowbtn} ${styles.danger}`}
            disabled={pending !== null}
            onClick={() => run('cancel')}
          >
            {pending === 'cancel' ? 'מבטל…' : reversesPayment ? 'כן, לבטל ולהחזיר את הכסף' : 'כן, לבטל'}
          </button>
          <button
            type="button"
            className={styles.rowbtn}
            disabled={pending !== null}
            onClick={() => {
              setConfirming(false)
              setError(null)
            }}
          >
            לא, להשאיר
          </button>
        </div>
        {error && <p className={styles.rowError}>{error}</p>}
      </div>
    )
  }

  return (
    <div className={styles.actWrap}>
      <div className={styles.acts}>
        {/* Nothing left to chase on a dead order — except one the seller
            confirmed and then cancelled, where the buyer is owed their money
            back and this is the only way the app offers to tell them. */}
        {(!isDead || paymentConfirmed) && (
          <a className={`${styles.rowbtn} ${styles.wa}`} href={waHref} target="_blank" rel="noreferrer">
            וואטסאפ
          </a>
        )}
        {status === 'CLAIMED_PAID' && (
          <button
            type="button"
            className={`${styles.rowbtn} ${styles.go}`}
            disabled={pending !== null}
            onClick={() => run('confirm')}
          >
            {pending === 'confirm' ? 'מאשר…' : 'אישור תשלום'}
          </button>
        )}
        {!isDead && (
          <button
            type="button"
            className={styles.rowbtn}
            disabled={pending !== null}
            onClick={() => {
              setConfirming(true)
              setError(null)
            }}
          >
            ביטול
          </button>
        )}
        {(status === 'PAID' || isDead) && (
          <a className={styles.rowbtn} href={`/o/${token}`} target="_blank" rel="noreferrer">
            פרטים
          </a>
        )}
      </div>
      {error && <p className={styles.rowError}>{error}</p>}
    </div>
  )
}
