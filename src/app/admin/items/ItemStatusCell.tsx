'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SELLABLE_STATUSES, type SellableStatus } from '@/lib/admin/item-status'
import { setItemStatusAction, deleteItemAction } from './actions'
import styles from './items.module.css'

const LABEL: Record<SellableStatus, string> = {
  AVAILABLE: 'זמין',
  RESERVED: 'שמור',
  HIDDEN: 'מוסתר',
  SOLD: 'נמכר',
}

const CLASS: Record<string, string> = {
  AVAILABLE: 'ok',
  RESERVED: 'hold',
  SOLD: 'sold',
  DRAFT: 'draft',
  HIDDEN: 'hidden',
}

const ALL_LABEL: Record<string, string> = { ...LABEL, DRAFT: 'טיוטה' }

/**
 * The status chip in the item table, turned into the control it looked like.
 *
 * It was a coloured label, and changing a status meant opening the item's edit
 * screen — twelve screens to reserve twelve things, and no way at all to
 * remove a duplicate that had been marked sold. Now it opens in place: the
 * four statuses, and a delete for an item no order has ever touched.
 *
 * A DRAFT is shown but not offered: it belongs to an unfinished import, and
 * `setItemStatus` refuses it — publishing is what moves it, on the import
 * screen that knows what else is in the batch.
 *
 * Delete asks twice, because it is the one thing here that cannot be undone
 * and it sits one row away from four things that can.
 */
export function ItemStatusCell({
  id,
  status,
  name,
}: {
  id: string
  status: string
  /** Shown in the delete confirmation, because a row of chips all look alike. */
  name: string
}) {
  const router = useRouter()
  /**
   * Where the menu is pinned on screen, or null when it is closed.
   *
   * Fixed coordinates rather than an absolutely-positioned child, because the
   * table sits in a `.tableWrap` with `overflow-x: auto` — and an overflow
   * container clips its descendants in BOTH axes, so the menu on the last row
   * was cut off halfway down. Measured from the chip at the moment it is
   * opened, which is also what lets it flip upwards near the bottom.
   */
  const [menuAt, setMenuAt] = useState<{ top: number; right: number } | null>(null)
  const open = menuAt !== null
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDraft = status === 'DRAFT'

  /** Roughly the menu's height — enough to know whether it fits below the chip. */
  const MENU_H = isDraft ? 170 : 290

  /**
   * Pins the menu to the chip, wherever the chip currently is.
   *
   * `right` and not `left`: the document is RTL, so the menu's start edge is
   * the chip's right edge. Flips above the chip when there is not room below,
   * which is the common case for the last row of a long table.
   */
  const placeMenu = useCallback(() => {
    const chip = chipRef.current
    if (chip === null) return
    const r = chip.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    setMenuAt({
      right: Math.max(8, window.innerWidth - r.right),
      top: below < MENU_H + 16 ? Math.max(8, r.top - MENU_H - 6) : r.bottom + 6,
    })
  }, [MENU_H])

  /**
   * A fixed menu does not travel with the page, so it is re-pinned on scroll
   * rather than dismissed.
   *
   * Closing on scroll was the first attempt and it was wrong in a way that
   * only showed up in a browser: the act of opening the menu can itself cause
   * a scroll — the browser bringing the chip into view — and the menu shut
   * again in the same breath. On a phone the address bar collapsing would have
   * done it too, mid-tap.
   */
  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', placeMenu, true)
    window.addEventListener('resize', placeMenu)
    return () => {
      window.removeEventListener('scroll', placeMenu, true)
      window.removeEventListener('resize', placeMenu)
    }
  }, [open, placeMenu])

  function toggle() {
    if (open) return setMenuAt(null)
    placeMenu()
  }

  async function change(next: SellableStatus) {
    if (busy || next === status) return setMenuAt(null)
    setBusy(true)
    setError(null)
    try {
      const result = await setItemStatusAction(id, next)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setMenuAt(null)
      router.refresh()
    } catch (err) {
      console.error('[items] changing the status failed:', err)
      setError('הפעולה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await deleteItemAction(id)
      if (!result.ok) {
        setConfirmingDelete(false)
        setError(result.error)
        return
      }
      // No close here: the row this menu lives in is about to stop existing.
      router.refresh()
    } catch (err) {
      console.error('[items] deleting the item failed:', err)
      setConfirmingDelete(false)
      setError('המחיקה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.statusCell}>
      <button
        type="button"
        className={`${styles.pill} ${styles[CLASS[status] ?? 'ok']} ${styles.pillBtn}`}
        ref={chipRef}
        onClick={() => {
          setError(null)
          setConfirmingDelete(false)
          toggle()
        }}
        aria-expanded={open}
        aria-label={`שינוי הסטטוס של ${name}. כרגע: ${ALL_LABEL[status] ?? status}`}
      >
        {ALL_LABEL[status] ?? status}
        <span aria-hidden className={styles.caret}>
          ⌄
        </span>
      </button>

      {menuAt !== null && (
        <>
          {/* Catches the click that closes the menu, and nothing else: the
              chip is a fixed-position menu's only anchor, so without this a
              seller would have to press the chip again to dismiss it. */}
          <button
            type="button"
            className={styles.scrim}
            aria-label="סגירת התפריט"
            onClick={() => setMenuAt(null)}
          />
        <div
          className={styles.statusMenu}
          role="group"
          aria-label={`סטטוס של ${name}`}
          style={{ top: menuAt.top, right: menuAt.right }}
        >
          {isDraft ? (
            <p className={styles.menuNote}>הפריט טיוטה מייבוא שלא הושלם. פרסמו אותו ממסך הייבוא.</p>
          ) : (
            SELLABLE_STATUSES.map((option) => (
              <button
                key={option}
                type="button"
                className={option === status ? `${styles.menuItem} ${styles.menuOn}` : styles.menuItem}
                disabled={busy}
                onClick={() => void change(option)}
              >
                {LABEL[option]}
              </button>
            ))
          )}

          <div className={styles.menuSep} aria-hidden />

          {confirmingDelete ? (
            <>
              <p className={styles.menuNote}>למחוק לגמרי? אי אפשר לבטל.</p>
              <button type="button" className={styles.menuDanger} disabled={busy} onClick={() => void remove()}>
                {busy ? 'מוחק…' : 'כן, למחוק'}
              </button>
              <button type="button" className={styles.menuItem} disabled={busy} onClick={() => setConfirmingDelete(false)}>
                ביטול
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.menuDanger}
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
            >
              מחיקת הפריט
            </button>
          )}
        </div>
        </>
      )}

      {error && (
        <p className={styles.statusErr} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
