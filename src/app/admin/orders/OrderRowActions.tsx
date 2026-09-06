'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmPaymentAction, cancelOrderAction } from './actions'
import styles from './orders.module.css'

type Props = {
  orderId: string
  token: string
  status: 'PENDING_PAYMENT' | 'CLAIMED_PAID' | 'PAID' | 'EXPIRED' | 'CANCELLED'
  waHref: string
}

/**
 * The row-level controls: WhatsApp always (except once an order is dead —
 * there's nothing left to chase), plus exactly one status-appropriate
 * action — `אישור תשלום` for a CLAIMED_PAID row, `ביטול` for a
 * PENDING_PAYMENT one, or a read-only `פרטים` link once the order is
 * settled. `אישור תשלום`/`ביטול` both go through the same two server
 * actions, which are themselves thin wrappers over
 * src/lib/orders/transitions.ts — no state rule is re-encoded here.
 */
export function OrderRowActions({ orderId, token, status, waHref }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState<'confirm' | 'cancel' | null>(null)
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
    router.refresh()
  }

  const isDead = status === 'EXPIRED' || status === 'CANCELLED'

  return (
    <div className={styles.actWrap}>
      <div className={styles.acts}>
        {!isDead && (
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
        {status === 'PENDING_PAYMENT' && (
          <button type="button" className={styles.rowbtn} disabled={pending !== null} onClick={() => run('cancel')}>
            {pending === 'cancel' ? 'מבטל…' : 'ביטול'}
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
