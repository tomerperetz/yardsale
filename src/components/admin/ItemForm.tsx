'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createItemAction, updateItemAction } from '@/app/admin/items/actions'
import { PhotoDrop, type PhotoInfo } from './PhotoDrop'
import styles from './admin.module.css'

const DRAFT_NAME = 'פריט חדש'
const FALLBACK_CATEGORY = 'כללי'

/**
 * The single-item entry form. Photos need an item row to attach to before
 * any upload can happen, so a DRAFT item is created as soon as one isn't
 * already in flight (task-18-correction.md §0) and every upload targets it
 * directly. Saving — either button — validates and publishes/keeps-draft
 * through the same draft row, then resets name/description/price/photos
 * for the next item while keeping category and pickup window, and opens a
 * fresh draft so the seller can start dropping the next item's photos
 * immediately.
 */
export function ItemForm({
  categories,
  initialCategory,
  initialPickupFrom,
  initialPickupTo,
  itemCount,
}: {
  categories: string[]
  initialCategory: string
  initialPickupFrom: string
  initialPickupTo: string
  itemCount: number
}) {
  const router = useRouter()
  const [draftId, setDraftId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState(initialCategory)
  const [pickupFrom, setPickupFrom] = useState(initialPickupFrom)
  const [pickupTo, setPickupTo] = useState(initialPickupTo)
  const [photos, setPhotos] = useState<PhotoInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const categoryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (draftId !== null) return
    let cancelled = false
    createItemAction({
      name: DRAFT_NAME,
      description: '',
      price: '0',
      categoryName: category || FALLBACK_CATEGORY,
      pickupFrom,
      pickupTo,
      photoIds: [],
      publish: false,
    }).then((r) => {
      if (cancelled) return
      if (r.ok) setDraftId(r.id)
      else setError(r.error)
    })
    return () => {
      cancelled = true
    }
    // Deliberately keyed only on draftId — re-running on every category/
    // pickup keystroke would spawn a fresh draft item per character typed.
    // The draft's placeholder category never reaches the buyer: the eventual
    // save always re-resolves categoryId from the real, current value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])

  async function handleSave(publish: boolean) {
    if (!draftId || pending) return
    setPending(true)
    setError(null)
    const result = await updateItemAction(draftId, {
      name,
      description,
      price,
      categoryName: category,
      pickupFrom,
      pickupTo,
      photoIds: photos.map((p) => p.id),
      publish,
    })
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setName('')
    setDescription('')
    setPrice('')
    setPhotos([])
    setDraftId(null)
    router.refresh()
  }

  return (
    <div className={styles.form}>
      {draftId ? (
        <PhotoDrop itemId={draftId} photos={photos} onPhotosChange={setPhotos} />
      ) : (
        <div className={styles.drop}>
          <div className={styles.dropHint}>
            <b>מכינים מקום לתמונות…</b>
          </div>
        </div>
      )}

      <div className={styles.fields}>
        {error && (
          <div className={styles.errors}>
            <p>{error}</p>
          </div>
        )}

        <div>
          <label className="lbl" htmlFor="item-name">
            שם הפריט
          </label>
          <input
            id="item-name"
            className="fld"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ספה תלת־מושבית"
          />
        </div>

        <div>
          <label className="lbl" htmlFor="item-desc">
            תיאור <span className={styles.hint}>שתיים־שלוש שורות, כולל פגמים</span>
          </label>
          <textarea
            id="item-desc"
            className="fld"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label className="lbl" htmlFor="item-category">
            קטגוריה
          </label>
          <input
            id="item-category"
            ref={categoryInputRef}
            className="fld"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="הקלידו קטגוריה חדשה…"
          />
          <div className={styles.cats}>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={c === category ? `${styles.cat} ${styles.on}` : styles.cat}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
            <button
              type="button"
              className={`${styles.cat} ${styles.new}`}
              onClick={() => {
                setCategory('')
                categoryInputRef.current?.focus()
              }}
            >
              + חדשה
            </button>
          </div>
        </div>

        <div className={styles.two}>
          <div>
            <label className="lbl" htmlFor="item-price">
              מחיר
            </label>
            <div className={styles.money}>
              <span>₪</span>
              <input
                id="item-price"
                className="fld"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="lbl">חלון איסוף</label>
            <div className={styles.two} style={{ gap: 8 }}>
              <input
                type="date"
                className="fld"
                value={pickupFrom}
                onChange={(e) => setPickupFrom(e.target.value)}
                aria-label="מתאריך"
              />
              <input
                type="date"
                className="fld"
                value={pickupTo}
                onChange={(e) => setPickupTo(e.target.value)}
                aria-label="עד תאריך"
              />
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-accent"
            disabled={!draftId || pending}
            onClick={() => handleSave(true)}
          >
            שמירה והפריט הבא
          </button>
          <button type="button" className="btn" disabled={!draftId || pending} onClick={() => handleSave(false)}>
            שמירה כטיוטה
          </button>
          <span className={styles.sp}>{itemCount} פריטים במכירה</span>
        </div>
      </div>
    </div>
  )
}
