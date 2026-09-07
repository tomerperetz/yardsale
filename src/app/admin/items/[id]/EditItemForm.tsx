'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateItemAction, deleteItemAction, setItemStatusAction } from '@/app/admin/items/actions'
import { SELLABLE_STATUSES, type SellableStatus } from '@/lib/admin/item-status'
import { PhotoDrop, type PhotoInfo } from '@/components/admin/PhotoDrop'
import formStyles from '@/components/admin/admin.module.css'
import styles from '../items.module.css'

const NOT_DELETABLE = new Set(['RESERVED', 'SOLD'])

const STATUS_LABEL: Record<SellableStatus, string> = {
  AVAILABLE: 'זמין למכירה',
  SOLD: 'נמכר',
}

type EditableItem = {
  id: string
  name: string
  description: string
  price: string
  status: string
  categoryName: string
  pickupFrom: string
  pickupTo: string
  photos: PhotoInfo[]
}

/**
 * The existing-item edit screen: the same field set as the create form,
 * plus photo management (via the shared PhotoDrop) and deletion.
 *
 * Unlike the create flow, saving here must never flip a RESERVED/SOLD item
 * back to AVAILABLE as a side effect of an unrelated edit — updateItem only
 * touches `status` when `publish` is true, so this only ever sends
 * `publish: true` for a DRAFT item the seller explicitly chooses to publish.
 */
export function EditItemForm({ item, categories }: { item: EditableItem; categories: string[] }) {
  const router = useRouter()

  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description)
  const [price, setPrice] = useState(item.price)
  const [category, setCategory] = useState(item.categoryName)
  const [pickupFrom, setPickupFrom] = useState(item.pickupFrom)
  const [pickupTo, setPickupTo] = useState(item.pickupTo)
  const [photos, setPhotos] = useState<PhotoInfo[]>(item.photos)
  const [publishNow, setPublishNow] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const categoryInputRef = useRef<HTMLInputElement>(null)

  // Status is the one field that moves on its own — an order can reserve or
  // sell this item while the seller has the form open — so it is held in state
  // and re-read from the server's answer rather than from the prop.
  const [status, setStatus] = useState(item.status)
  const [statusPending, setStatusPending] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const isDraft = status === 'DRAFT'

  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const blocked = NOT_DELETABLE.has(status)

  async function handleSave() {
    if (pending) return
    setPending(true)
    setError(null)
    const result = await updateItemAction(item.id, {
      name,
      description,
      price,
      categoryName: category,
      pickupFrom,
      pickupTo,
      photoIds: photos.map((p) => p.id),
      publish: isDraft ? publishNow : false,
    })
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.push('/admin/items')
    router.refresh()
  }

  async function handleStatus(next: SellableStatus) {
    if (statusPending || next === status) return
    setStatusPending(true)
    setStatusError(null)
    const result = await setItemStatusAction(item.id, next)
    setStatusPending(false)
    if (!result.ok) {
      setStatusError(result.error)
      // The refusal usually means an order moved the item underneath us, so
      // pull the real status back rather than leaving a stale chip lit.
      router.refresh()
      return
    }
    setStatus(next)
    router.refresh()
  }

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteItemAction(item.id)
    setDeleting(false)
    if (!result.ok) {
      setDeleteError(result.error)
      setConfirming(false)
      return
    }
    router.push('/admin/items')
    router.refresh()
  }

  return (
    <div>
      <div className={formStyles.form}>
        <PhotoDrop itemId={item.id} photos={photos} onPhotosChange={setPhotos} />

        <div className={formStyles.fields}>
          {error && (
            <div className={formStyles.errors}>
              <p>{error}</p>
            </div>
          )}

          <div>
            <label className="lbl" htmlFor="edit-name">
              שם הפריט
            </label>
            <input id="edit-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label className="lbl" htmlFor="edit-desc">
              תיאור
            </label>
            <textarea
              id="edit-desc"
              className="fld"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="lbl" htmlFor="edit-category">
              קטגוריה
            </label>
            <input
              id="edit-category"
              ref={categoryInputRef}
              className="fld"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <div className={formStyles.cats}>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c === category ? `${formStyles.cat} ${formStyles.on}` : formStyles.cat}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
              <button
                type="button"
                className={`${formStyles.cat} ${formStyles.new}`}
                onClick={() => {
                  setCategory('')
                  categoryInputRef.current?.focus()
                }}
              >
                + חדשה
              </button>
            </div>
          </div>

          <div className={formStyles.two}>
            <div>
              <label className="lbl" htmlFor="edit-price">
                מחיר
              </label>
              <div className={formStyles.money}>
                <span>₪</span>
                <input
                  id="edit-price"
                  className="fld"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="lbl">חלון איסוף</label>
              <div className={formStyles.two} style={{ gap: 8 }}>
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

          {isDraft && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
              פרסום הפריט עכשיו
            </label>
          )}

          {!isDraft && (
            <div>
              <span className="lbl">סטטוס</span>
              {statusError && (
                <div className={formStyles.errors}>
                  <p>{statusError}</p>
                </div>
              )}
              {status === 'RESERVED' ? (
                <p className={styles.statusNote}>
                  הפריט שמור להזמנה פעילה. הסטטוס שלו נקבע לפי ההזמנה — אפשר לשחרר אותו בביטול ההזמנה
                  במסך ההזמנות.
                </p>
              ) : (
                <>
                  <div className={formStyles.cats}>
                    {SELLABLE_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={s === status ? `${formStyles.cat} ${formStyles.on}` : formStyles.cat}
                        disabled={statusPending}
                        onClick={() => handleStatus(s)}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                  <p className={styles.statusNote}>
                    {status === 'SOLD'
                      ? 'הפריט מסומן כנמכר ומוצג בחנות מעומעם. אפשר להחזיר אותו למכירה.'
                      : 'נמכר למישהו שהגיע פיזית? סמנו כאן, והפריט יירד מהמכירה מיד.'}
                  </p>
                </>
              )}
            </div>
          )}

          <div className={formStyles.actions}>
            <button type="button" className="btn btn-accent" disabled={pending} onClick={handleSave}>
              {pending ? 'שומר…' : 'שמירה'}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.dangerZone}>
        {deleteError && <p className={styles.deleteError}>{deleteError}</p>}
        {blocked ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-3)' }}>אי אפשר למחוק פריט ששייך להזמנה.</p>
        ) : confirming ? (
          <div className={styles.dangerConfirm}>
            <p>למחוק את הפריט לצמיתות? הפעולה בלתי הפיכה.</p>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={deleting}>
              ביטול
            </button>
            <button type="button" className="btn btn-accent" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'מוחק…' : 'כן, למחוק'}
            </button>
          </div>
        ) : (
          <button type="button" className={styles.rowbtn} onClick={() => setConfirming(true)}>
            מחיקת פריט
          </button>
        )}
      </div>
    </div>
  )
}
