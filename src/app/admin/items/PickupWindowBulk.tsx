'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { setPickupWindowAction } from './actions'
import styles from './items.module.css'

/**
 * Sets one pickup window across the whole shop — the repair for a sale whose
 * dates have moved on.
 *
 * It exists because staleness is never one item's problem: the window is a
 * fact about the sale, so when it goes out of date it goes out of date on
 * everything at once, and the seller's alternative is opening twenty edit
 * screens in a row.
 *
 * Three things it owes the seller, in the order they matter:
 *
 * 1. It says how many items it will change BEFORE it changes them, and asks
 *    once. Twenty rows moving on a single click, with the count only in the
 *    aftermath, is the shape of an action people learn not to trust.
 * 2. It never moves an item a live order is holding. That is enforced in
 *    `setPickupWindowForAll`, not here — a client cannot be the thing standing
 *    between a buyer's chosen slot and a bulk update — and this screen's job
 *    is to name those items so their absence is visible rather than silent.
 * 3. The fields open at the sale window from Settings, so "apply" normally
 *    means "make the shop say what the settings already say". Typing dates
 *    here is for a one-off; changing the sale itself belongs in Settings,
 *    which is also where new items take their window from.
 *
 * The counts it renders are a snapshot — an order placed a second later moves
 * one — so the sentence after the fact reports what the server actually did,
 * not what this component predicted.
 */
export function PickupWindowBulk({
  movable,
  held,
  initialFrom,
  initialTo,
  saleWindowEnded,
}: {
  movable: number
  held: number
  initialFrom: string
  initialTo: string
  saleWindowEnded: boolean
}) {
  const router = useRouter()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  async function apply() {
    if (busy) return
    setBusy(true)
    setError(null)
    setFlash(null)
    try {
      const result = await setPickupWindowAction(from, to)
      if (!result.ok) {
        // Out of the confirmation and back to the fields: what failed is a
        // date the seller has to retype, and confirming the same one again
        // would fail the same way.
        setConfirming(false)
        setError(result.error)
        return
      }
      setConfirming(false)
      setFlash(appliedMessage(result.updated, result.skipped))
      // The table above these fields shows every item's window; without this
      // it would go on showing the dates that were just replaced.
      router.refresh()
    } catch (err) {
      console.error('[items] applying a pickup window across the shop failed:', err)
      setConfirming(false)
      setError('שגיאה בעדכון התאריכים. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.windowBulk}>
      <div className={styles.windowFields}>
        <div>
          <label className="lbl" htmlFor="all-pickup-from">
            איסוף מתאריך
          </label>
          <input
            id="all-pickup-from"
            className="fld"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setConfirming(false)
            }}
          />
        </div>
        <div>
          <label className="lbl" htmlFor="all-pickup-to">
            עד תאריך
          </label>
          <input
            id="all-pickup-to"
            className="fld"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setConfirming(false)
            }}
          />
        </div>

        {confirming ? (
          <div className={styles.windowConfirm}>
            <span>{`לעדכן את חלון האיסוף של ${itemCount(movable)}?`}</span>
            <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void apply()}>
              {busy ? 'רגע…' : 'כן, לעדכן'}
            </button>
            <button type="button" className={styles.windowBtn} disabled={busy} onClick={() => setConfirming(false)}>
              ביטול
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.windowBtn}
            disabled={busy || movable === 0}
            onClick={() => {
              setFlash(null)
              setError(null)
              setConfirming(true)
            }}
          >
            עדכון כל הפריטים
          </button>
        )}
      </div>

      <p className={styles.windowNote}>
        {movable === 0
          ? 'כל הפריטים שמורים להזמנות פעילות, ואין מה לעדכן.'
          : `העדכון ישנה את חלון האיסוף של ${itemCount(movable)}.`}
        {held > 0 && ` ${heldSentence(held)}`}
      </p>
      <p className={styles.windowNote}>
        התאריכים מגיעים מחלון המכירה שבהגדרות.{' '}
        <Link href="/admin/settings" className={styles.windowLink}>
          עדכון חלון המכירה
        </Link>
      </p>

      {/* The state that put a week already past on every item in the shop. It
          is not this screen's to fix — new items take their window from
          Settings — so it says where the fix is. */}
      {saleWindowEnded && (
        <p className={styles.windowWarn}>
          חלון המכירה שבהגדרות כבר הסתיים. עדכנו אותו כדי שפריטים חדשים לא ייפתחו בתאריכים שעברו.
        </p>
      )}

      {error && (
        <p className={styles.windowError} role="alert">
          {error}
        </p>
      )}
      {flash && (
        <p className={styles.windowFlash} role="status">
          {flash}
        </p>
      )}
    </section>
  )
}

/** "פריט אחד" / "7 פריטים" — Hebrew counts one item by name, not by number. */
function itemCount(n: number): string {
  return n === 1 ? 'פריט אחד' : `${n} פריטים`
}

/** What will be left alone, said before the fact. */
function heldSentence(held: number): string {
  return held === 1
    ? 'פריט אחד שמור להזמנה פעילה ויישאר עם התאריכים שלו.'
    : `${held} פריטים שמורים להזמנות פעילות ויישארו עם התאריכים שלהם.`
}

/**
 * What actually happened, in the server's own numbers rather than the ones
 * this component rendered a minute ago — an order placed in between moves an
 * item from the first count to the second.
 */
function appliedMessage(updated: number, skipped: number): string {
  const applied = updated === 0 ? 'לא עודכן אף פריט.' : `עודכן חלון האיסוף של ${itemCount(updated)}.`
  if (skipped === 0) return applied
  const left =
    skipped === 1
      ? 'פריט אחד שמור להזמנה פעילה ולא שונה.'
      : `${skipped} פריטים שמורים להזמנות פעילות ולא שונו.`
  return `${applied} ${left}`
}
