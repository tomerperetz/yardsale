'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { photoUrl } from '@/lib/photo-url'
import { DRAFT_NAME } from '@/lib/admin/draft'
import { normalizeForCompare } from '@/lib/category-name'
import { PickupWindow } from '@/components/PickupWindow'
import { updateItemAction } from '@/app/admin/items/actions'
import type { ImportNotice } from '@/lib/import/batch'
import {
  bulkEdit,
  clusterBatchAction,
  discardBatch,
  discardItems,
  movePhoto,
  publishItems,
  removePhoto,
} from '../actions'
import styles from '../import.module.css'

/**
 * Where the seller corrects what Claude proposed and finishes the job
 * (spec §7.3): a card per proposed item with its photo strip and its fields,
 * per-photo remove and move-to controls, and a bulk bar over the selection
 * that sets dates, category or price across many items at once, publishes
 * them, or throws them away.
 *
 * This component's state is authoritative for the duration of the review. It
 * is seeded from the server once and never re-seeded, because the seller is
 * typing into it: a server action's revalidation arriving mid-edit must not
 * replace a headline they are halfway through. The one path that needs the
 * server's answer instead — re-running the clustering over photos that never
 * got an item — reloads the page outright rather than merging.
 */

export type ReviewPhoto = { id: string; lqip: string }

export type ReviewItem = {
  id: string
  name: string
  description: string
  /** Shekels as the seller types them; '' for an imported draft nobody has priced. */
  price: string
  categoryName: string
  /** `<input type="date">` values — the strings the actions parse back. */
  pickupFrom: string
  pickupTo: string
  photos: ReviewPhoto[]
}

/** What a card minted mid-review opens with — see `handleMove`. */
export type ReviewDefaults = { categoryName: string; pickupFrom: string; pickupTo: string }

type Confirming = 'selection' | 'batch' | null

/** What a server action that threw is reported as — see `run` below. */
const ACTION_FAILED = 'הפעולה נכשלה. בדקו את החיבור ונסו שוב.'

/** How long a "saved" / "published" line stays before it stops being news. */
const FLASH_MS = 8000

export function ImportReview({
  batchId,
  items: initialItems,
  categories,
  newCategories,
  loosePhotos,
  notice,
  defaults,
}: {
  batchId: string
  items: ReviewItem[]
  categories: string[]
  /** Names that exist only because of this import — flagged so the seller sees them before accepting. */
  newCategories: string[]
  loosePhotos: ReviewPhoto[]
  notice: ImportNotice
  defaults: ReviewDefaults
}) {
  const categoryListId = useId()

  // A name the shop did not have before this import. Compared the same loose
  // way the AI client compares them — whitespace collapsed and a leading "ה"
  // dropped — so that editing "ריהוט" to "הריהוט" does not suddenly flag it as
  // new, and so a seller who types an existing name by hand sees no warning.
  // The photo the seller is looking at full size, and the strip it came from,
  // so the arrows can walk that item's photos without closing. `origin` is the
  // element to hand focus back to — a viewer that dumps a keyboard user at the
  // top of a long review screen is worse than no viewer.
  const [viewing, setViewing] = useState<{ ids: string[]; index: number } | null>(null)
  const viewerOrigin = useRef<HTMLElement | null>(null)

  const openViewer = (ids: string[], index: number, origin: HTMLElement | null) => {
    viewerOrigin.current = origin
    setViewing({ ids, index })
  }
  const closeViewer = useCallback(() => {
    setViewing(null)
    viewerOrigin.current?.focus()
    viewerOrigin.current = null
  }, [])
  const stepViewer = useCallback((by: number) => {
    setViewing((current) => {
      if (current === null) return current
      const next = (current.index + by + current.ids.length) % current.ids.length
      return { ...current, index: next }
    })
  }, [])

  useEffect(() => {
    if (viewing === null) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') closeViewer()
      // The document is RTL, so the arrow that points at the next photo on
      // screen is the LEFT one. Reading order, not array order.
      if (event.key === 'ArrowLeft') stepViewer(1)
      if (event.key === 'ArrowRight') stepViewer(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing, closeViewer, stepViewer])

  const newCategoryKeys = new Set(newCategories.map(normalizeForCompare))
  const isNewCategory = (name: string) => {
    const key = normalizeForCompare(name)
    return key !== '' && newCategoryKeys.has(key)
  }

  const [items, setItems] = useState(initialItems)
  const [loose, setLoose] = useState(loosePhotos)
  // Everything is selected to begin with: the seller's usual next move is one
  // pickup window and one publish across the whole drop, and nobody should
  // have to tick twenty boxes to get there.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialItems.map((item) => item.id)))
  const [dirty, setDirty] = useState<Set<string>>(() => new Set())
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [flash, setFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [publishedHere, setPublishedHere] = useState(0)
  /** What the whole-import discard took, once it has run. */
  const [discarded, setDiscarded] = useState<{ items: number; photos: number } | null>(null)

  const [bulkPrice, setBulkPrice] = useState('')
  const [bulkCategory, setBulkCategory] = useState(defaults.categoryName)
  const [bulkFrom, setBulkFrom] = useState(defaults.pickupFrom)
  const [bulkTo, setBulkTo] = useState(defaults.pickupTo)

  // A flash reports what just happened. Left up, it is still claiming five
  // minutes later that something was saved, over an edit made since.
  useEffect(() => {
    if (flash === null) return
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  const selectedIds = useMemo(
    () => items.filter((item) => selected.has(item.id)).map((item) => item.id),
    [items, selected],
  )

  function editItem(id: string, patch: Partial<ReviewItem>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    setDirty((prev) => new Set(prev).add(id))
  }

  function clearDirty(ids: Iterable<string>) {
    setDirty((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }

  function setItemError(id: string, error: string | null) {
    setItemErrors((prev) => {
      const next = { ...prev }
      if (error === null) delete next[id]
      else next[id] = error
      return next
    })
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Saves one card through the same `updateItem` the item edit screen uses,
   * so the validation and its Hebrew messages are identical here — and so a
   * draft's slug is regenerated from the headline the seller actually kept.
   */
  async function saveOne(item: ReviewItem): Promise<string | null> {
    const result = await updateItemAction(item.id, {
      name: item.name,
      description: item.description,
      price: item.price,
      categoryName: item.categoryName,
      pickupFrom: item.pickupFrom,
      pickupTo: item.pickupTo,
      // The import screen has already put every photo where the seller wants
      // it; `updateItem` does not attach photos.
      photoIds: [],
      publish: false,
    })
    return result.ok ? null : result.error
  }

  /**
   * Every action on this screen goes through here.
   *
   * A server action that THROWS — a dropped connection, a 500, a deploy
   * mid-edit — is not the `{ ok: false }` each handler below reads. Left to
   * themselves they would never reach their own `setBusy(false)`, so the
   * screen would freeze with every control disabled and nothing said, and the
   * only way out would be a reload: the seller loses the twenty cards they
   * have just corrected because one request did not come back. So the flag is
   * cleared in a `finally` and the throw becomes one Hebrew line.
   */
  async function run(work: () => Promise<void>) {
    setBusy(true)
    setErrors([])
    try {
      await work()
    } catch (err) {
      console.error('[import] a review action failed:', err)
      setErrors([ACTION_FAILED])
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(item: ReviewItem) {
    await run(async () => {
      setFlash(null)
      const error = await saveOne(item)
      setItemError(item.id, error)
      if (error === null) {
        clearDirty([item.id])
        setFlash('נשמר.')
      }
    })
  }

  /**
   * One patch across the whole selection. A pickup window always goes whole —
   * both ends in one call — because one end alone would have to be checked
   * against each item's stored other end, and `bulkEdit` is all-or-nothing.
   */
  async function applyBulk(patch: { price?: string; categoryName?: string; pickupFrom?: string; pickupTo?: string }) {
    if (selectedIds.length === 0) return
    await run(async () => {
      setFlash(null)

      const result = await bulkEdit(selectedIds, patch)
      if (!result.ok) {
        setErrors([result.error])
        return
      }

      setItems((prev) => prev.map((item) => (selected.has(item.id) ? { ...item, ...patch } : item)))
      setFlash(selectedIds.length === 1 ? 'הפריט עודכן.' : `עודכנו ${selectedIds.length} פריטים.`)
    })
  }

  /**
   * Publishes the selection, saving first what the seller has typed into it:
   * `publishItems` republishes what is in the database, so an unsaved
   * headline would otherwise go live as the placeholder it replaced.
   *
   * A card that cannot be saved or cannot be published keeps its place with
   * its own message on it — one missing price must not cost the seller the
   * other nineteen, and `publishItems` refuses on its own account too: an
   * item a live order is counting on, or one already sold, is told so here
   * rather than quietly skipped.
   */
  async function handlePublish() {
    if (selectedIds.length === 0) return
    await run(async () => {
      setFlash(null)

      const refusals: Record<string, string> = {}
      const ready: string[] = []

      for (const item of items) {
        if (!selected.has(item.id)) continue
        if (dirty.has(item.id)) {
          const error = await saveOne(item)
          if (error !== null) {
            refusals[item.id] = error
            continue
          }
        }
        ready.push(item.id)
      }

      if (ready.length > 0) {
        const result = await publishItems(ready)
        for (const refusal of result.refused) refusals[refusal.id] = refusal.error
      }

      const published = new Set(ready.filter((id) => !(id in refusals)))

      setItems((prev) => prev.filter((item) => !published.has(item.id)))
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of published) next.delete(id)
        return next
      })
      // `ready` and not just `published`: an item that was saved here and then
      // refused by publishItems has been written, and a card that says it
      // still has unsaved changes when it does not is a lie the seller will
      // act on.
      clearDirty(ready)
      setItemErrors(refusals)
      setPublishedHere((count) => count + published.size)
      setFlash(
        published.size === 0 ? null : published.size === 1 ? 'פריט אחד פורסם.' : `פורסמו ${published.size} פריטים.`,
      )
      if (Object.keys(refusals).length > 0) {
        setErrors(['חלק מהפריטים לא פורסמו. ההסבר מופיע על הכרטיס של כל אחד מהם.'])
      }
    })
  }

  /**
   * Discards the selection, and keeps whatever it would not.
   *
   * `discardItems` refuses an item that is no longer a draft — another tab may
   * have published it while this one went on rendering its card — so the cards
   * cannot all be removed on the strength of having asked. Saying נמחקו over
   * items that are still there is how a seller learns to distrust the screen.
   */
  async function handleDiscardSelection() {
    const doomed = selectedIds
    if (doomed.length === 0) return
    setConfirming(null)
    setErrors([])
    await run(async () => {
      const result = await discardItems(doomed)

      const refusals: Record<string, string> = {}
      for (const refusal of result.refused) refusals[refusal.id] = refusal.error

      const gone = new Set(doomed.filter((id) => !(id in refusals)))
      setItems((prev) => prev.filter((item) => !gone.has(item.id)))
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of gone) next.delete(id)
        return next
      })
      clearDirty(gone)
      setItemErrors(refusals)
      setFlash(gone.size === 0 ? null : gone.size === 1 ? 'הפריט נמחק.' : `נמחקו ${gone.size} פריטים.`)
      if (result.refused.length > 0) {
        setErrors(['חלק מהפריטים לא נמחקו. ההסבר מופיע על הכרטיס של כל אחד מהם.'])
      }
    })
  }

  /**
   * The whole import, and the only control that reaches a photo which never
   * got an item (spec §7.3).
   *
   * It stays on the screen rather than leaving for the item list, because
   * `discardBatch` comes back with what it deleted and that is worth showing:
   * an item an order is counting on is kept, so "everything" is not always
   * everything, and a seller who is told the counts can tell the difference.
   */
  async function handleDiscardBatch() {
    setConfirming(null)
    await run(async () => {
      const result = await discardBatch(batchId)
      setItems([])
      setLoose([])
      setSelected(new Set())
      setDirty(new Set())
      setItemErrors({})
      setFlash(null)
      setDiscarded({ items: result.items, photos: result.photos })
    })
  }

  async function handleRemovePhoto(photoId: string, itemId: string | null) {
    await run(async () => {
      const result = await removePhoto(photoId)
      if (!result.ok) {
        setErrors([result.error])
        return
      }

      if (itemId === null) setLoose((prev) => prev.filter((photo) => photo.id !== photoId))
      else {
        setItems((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, photos: item.photos.filter((photo) => photo.id !== photoId) } : item,
          ),
        )
      }
    })
  }

  /**
   * Moves one photo onto another item of this batch, or onto a brand new one.
   *
   * A new card is added here from the same defaults the server creates it
   * with, and marked unsaved on purpose: publishing saves every unsaved card
   * first, so what the seller is shown is what gets published even if the
   * server's carried-forward defaults have drifted from this prediction.
   */
  async function handleMove(photoId: string, fromItemId: string, toItemId: string) {
    await run(async () => {
      const result = await movePhoto(photoId, toItemId === 'new' ? 'new' : toItemId)
      if (!result.ok) {
        setErrors([result.error])
        return
      }

      const destination = result.itemId
      const photo =
        fromItemId === ''
          ? loose.find((candidate) => candidate.id === photoId)
          : items.find((item) => item.id === fromItemId)?.photos.find((candidate) => candidate.id === photoId)

      if (!photo) return

      if (fromItemId === '') setLoose((prev) => prev.filter((candidate) => candidate.id !== photoId))

      setItems((prev) => {
        const without = prev.map((item) =>
          item.id === fromItemId
            ? { ...item, photos: item.photos.filter((candidate) => candidate.id !== photoId) }
            : item,
        )
        if (without.some((item) => item.id === destination)) {
          // Appended, never inserted: the first photo of an item is its cover
          // and a photo dragged over from elsewhere must not become it.
          return without.map((item) =>
            item.id === destination ? { ...item, photos: [...item.photos, photo] } : item,
          )
        }
        return [
          ...without,
          {
            id: destination,
            name: DRAFT_NAME,
            description: '',
            price: '',
            categoryName: defaults.categoryName,
            pickupFrom: defaults.pickupFrom,
            pickupTo: defaults.pickupTo,
            photos: [photo],
          },
        ]
      })

      if (!items.some((item) => item.id === destination)) {
        setSelected((prev) => new Set(prev).add(destination))
        setDirty((prev) => new Set(prev).add(destination))
      }
    })
  }

  /**
   * Groups whatever is still loose in this batch. Reachable only when the
   * first attempt never ran or hard-failed, which is also why it reloads
   * rather than merging: the items it creates are the server's to describe.
   */
  async function handleCluster() {
    await run(async () => {
      const result = await clusterBatchAction(batchId)
      if (!result.ok) {
        setErrors([result.error])
        return
      }
      const query = result.notice === 'NONE' ? '' : `?notice=${result.notice}`
      window.location.href = `/admin/items/import/${batchId}${query}`
    })
  }


  const noticeLine =
    notice === 'OUT_OF_CREDIT'
      ? 'לא יצרנו שמות ותיאורים אוטומטיים: אין יתרה בחשבון הבינה המלאכותית. כל השאר עובד כרגיל — התמונות קובצו לפי זמן הצילום, ואפשר למלא את הפרטים ולפרסם.'
      : notice === 'NO_COPY'
        ? 'לא יצרנו שמות ותיאורים אוטומטיים לייבוא הזה. התמונות קובצו לפי זמן הצילום, ואפשר לתקן את הקיבוץ ולמלא את הפרטים.'
        : null

  if (items.length === 0 && loose.length === 0) {
    return (
      <div className={styles.empty}>
        <p>{closingLine(discarded, publishedHere)}</p>
        <Link href="/admin/items" className="btn btn-dark">
          לרשימת הפריטים
        </Link>
      </div>
    )
  }

  return (
    <div>
      {noticeLine && (
        <div className={notice === 'OUT_OF_CREDIT' ? `${styles.notice} ${styles.noticeWarn}` : styles.notice}>
          <p>{noticeLine}</p>
        </div>
      )}

      {flash && <p className={styles.flash}>{flash}</p>}

      {errors.length > 0 && (
        <div className={styles.error}>
          {errors.map((error, i) => (
            <p key={i}>{error}</p>
          ))}
        </div>
      )}

      {loose.length > 0 && (
        <div className={styles.loose}>
          <p>
            {loose.length === 1
              ? 'תמונה אחת עדיין לא שויכה לפריט.'
              : `${loose.length} תמונות עדיין לא שויכו לפריט.`}
          </p>
          <div className={styles.strip}>
            {loose.map((photo) => (
              <div key={photo.id} className={styles.shot}>
                <div className={styles.thumb}>
                  <button
                    type="button"
                    className={styles.zoom}
                    onClick={(e) => openViewer(loose.map((p) => p.id), loose.indexOf(photo), e.currentTarget)}
                    aria-label="הגדלת התמונה"
                  >
                    <img src={photoUrl(photo.id)} alt="" style={{ backgroundImage: `url(${photo.lqip})` }} />
                  </button>
                  <button
                    type="button"
                    className={styles.rm}
                    onClick={() => void handleRemovePhoto(photo.id, null)}
                    disabled={busy}
                    aria-label="הסרת התמונה"
                  >
                    ✕
                  </button>
                </div>
                <select
                  className={styles.move}
                  value=""
                  disabled={busy}
                  aria-label="העברת התמונה לפריט"
                  onChange={(e) => {
                    const value = e.target.value
                    e.target.value = ''
                    if (value !== '') void handleMove(photo.id, '', value)
                  }}
                >
                  <option value="">העברה אל…</option>
                  {items.map((target, index) => (
                    <option key={target.id} value={target.id}>
                      {optionLabel(target, index)}
                    </option>
                  ))}
                  <option value="new">פריט חדש</option>
                </select>
              </div>
            ))}
          </div>
          <button type="button" className={styles.act} onClick={() => void handleCluster()} disabled={busy}>
            קיבוץ התמונות שנותרו לפריטים
          </button>
        </div>
      )}

      <div className={styles.cards}>
        {items.map((item, index) => {
          const isSelected = selected.has(item.id)
          const from = utcDateOrNull(item.pickupFrom)
          const to = utcDateOrNull(item.pickupTo)
          return (
            <article key={item.id} className={isSelected ? `${styles.card} ${styles.cardOn}` : styles.card}>
              <div className={styles.cardHead}>
                <label className={styles.check}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggle(item.id)} />
                  <span>פריט {index + 1}</span>
                </label>
                <span className={styles.count}>{photosLabel(item.photos.length)}</span>
                {from && to && (
                  <span className={styles.window}>
                    איסוף: <PickupWindow from={from} to={to} />
                  </span>
                )}
              </div>

              {item.photos.length === 0 ? (
                <p className={styles.footerNote}>אין תמונות בפריט הזה. אפשר להעביר אליו תמונה מפריט אחר או למחוק אותו.</p>
              ) : (
                <div className={styles.strip}>
                  {item.photos.map((photo, photoIndex) => (
                    <div key={photo.id} className={styles.shot}>
                      <div className={photoIndex === 0 ? `${styles.thumb} ${styles.cover}` : styles.thumb}>
                        <button
                          type="button"
                          className={styles.zoom}
                          onClick={(e) =>
                            openViewer(item.photos.map((p) => p.id), photoIndex, e.currentTarget)
                          }
                          aria-label="הגדלת התמונה"
                        >
                          <img src={photoUrl(photo.id)} alt="" style={{ backgroundImage: `url(${photo.lqip})` }} />
                        </button>
                        <button
                          type="button"
                          className={styles.rm}
                          onClick={() => void handleRemovePhoto(photo.id, item.id)}
                          disabled={busy}
                          aria-label="הסרת התמונה"
                        >
                          ✕
                        </button>
                      </div>
                      <select
                        className={styles.move}
                        value=""
                        disabled={busy}
                        aria-label="העברת התמונה לפריט"
                        onChange={(e) => {
                          const value = e.target.value
                          e.target.value = ''
                          if (value !== '') void handleMove(photo.id, item.id, value)
                        }}
                      >
                        <option value="">העברה אל…</option>
                        {items
                          .map((target, targetIndex) => ({ target, targetIndex }))
                          .filter(({ target }) => target.id !== item.id)
                          .map(({ target, targetIndex }) => (
                            <option key={target.id} value={target.id}>
                              {optionLabel(target, targetIndex)}
                            </option>
                          ))}
                        <option value="new">פריט חדש</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.fields}>
                <div>
                  <label className="lbl" htmlFor={`name-${item.id}`}>
                    שם הפריט
                  </label>
                  <input
                    id={`name-${item.id}`}
                    className="fld"
                    value={item.name}
                    onChange={(e) => editItem(item.id, { name: e.target.value })}
                    placeholder="מנורת קריאה"
                  />
                </div>
                <div>
                  <label className="lbl" htmlFor={`desc-${item.id}`}>
                    תיאור
                  </label>
                  <textarea
                    id={`desc-${item.id}`}
                    className="fld"
                    value={item.description}
                    onChange={(e) => editItem(item.id, { description: e.target.value })}
                    placeholder="שתיים־שלוש שורות, כולל פגמים"
                  />
                </div>
                <div className={styles.pair}>
                  <div>
                    <label className="lbl" htmlFor={`price-${item.id}`}>
                      מחיר
                    </label>
                    <div className={styles.money}>
                      <span>₪</span>
                      <input
                        id={`price-${item.id}`}
                        className="fld"
                        inputMode="decimal"
                        value={item.price}
                        onChange={(e) => editItem(item.id, { price: e.target.value })}
                        placeholder="90"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="lbl" htmlFor={`category-${item.id}`}>
                      קטגוריה
                    </label>
                    <input
                      id={`category-${item.id}`}
                      className="fld"
                      value={item.categoryName}
                      onChange={(e) => editItem(item.id, { categoryName: e.target.value })}
                      list={categoryListId}
                      aria-describedby={isNewCategory(item.categoryName) ? `newcat-${item.id}` : undefined}
                    />
                    {isNewCategory(item.categoryName) && (
                      <p id={`newcat-${item.id}`} className={styles.newCat}>
                        קטגוריה חדשה — לא הייתה לכם עד עכשיו. אפשר לשנות לשם קיים.
                      </p>
                    )}
                  </div>
                </div>
                <div className={styles.pair}>
                  <div>
                    <label className="lbl" htmlFor={`from-${item.id}`}>
                      איסוף מתאריך
                    </label>
                    <input
                      id={`from-${item.id}`}
                      className="fld"
                      type="date"
                      value={item.pickupFrom}
                      onChange={(e) => editItem(item.id, { pickupFrom: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="lbl" htmlFor={`to-${item.id}`}>
                      עד תאריך
                    </label>
                    <input
                      id={`to-${item.id}`}
                      className="fld"
                      type="date"
                      value={item.pickupTo}
                      onChange={(e) => editItem(item.id, { pickupTo: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.cardFoot}>
                <button
                  type="button"
                  className={styles.act}
                  onClick={() => void handleSave(item)}
                  disabled={busy || !dirty.has(item.id)}
                >
                  {dirty.has(item.id) ? 'שמירת הפריט' : 'נשמר'}
                </button>
                {itemErrors[item.id] && <p className={styles.cardError}>{itemErrors[item.id]}</p>}
              </div>
            </article>
          )
        })}
      </div>

      <datalist id={categoryListId}>
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>

      {items.length > 0 && (
        <div className={styles.bar}>
          <div className={styles.barRow}>
            {/* The scope lives in this count, which is why the two buttons
                beside it can be one word each — three words apiece wrapped the
                bar onto a second row on a 390px phone, permanently, over the
                card being edited. */}
            <span className={styles.barCount}>
              נבחרו {selectedIds.length} מתוך {items.length}
            </span>
            <span className={styles.barSpace} />
            {confirming === 'selection' ? (
              <>
                <span className={styles.barCount}>
                  {selectedIds.length === 1 ? 'למחוק את הפריט שנבחר?' : `למחוק ${selectedIds.length} פריטים?`}
                </span>
                <button
                  type="button"
                  className={`${styles.act} ${styles.danger}`}
                  onClick={() => void handleDiscardSelection()}
                  disabled={busy}
                >
                  כן, למחוק
                </button>
                <button type="button" className={styles.act} onClick={() => setConfirming(null)} disabled={busy}>
                  ביטול
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`${styles.act} ${styles.danger}`}
                onClick={() => setConfirming('selection')}
                disabled={busy || selectedIds.length === 0}
              >
                מחיקה
              </button>
            )}
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => void handlePublish()}
              disabled={busy || selectedIds.length === 0}
            >
              {busy ? 'רגע…' : 'פרסום'}
            </button>
          </div>

          {/*
            Only the count, discard and publish are always up. On a 390px phone
            the whole bar was taking a fifth of the viewport over the card being
            edited — and it is up from first paint, since everything starts
            selected. Select-all and clear belong with the rest of the "do this
            to all of them" controls anyway.
          */}
          <details className={styles.bulkEdit}>
            <summary>בחירה ועריכה של כל הנבחרים</summary>
            <div className={styles.bulkFields}>
              <button
                type="button"
                className={styles.act}
                onClick={() => setSelected(new Set(items.map((item) => item.id)))}
                disabled={busy || selectedIds.length === items.length}
              >
                בחירת הכול
              </button>
              <button
                type="button"
                className={styles.act}
                onClick={() => setSelected(new Set())}
                disabled={busy || selectedIds.length === 0}
              >
                ניקוי הבחירה
              </button>
            </div>
            <div className={styles.bulkFields}>
              <div className={styles.bulkField}>
                <label className="lbl" htmlFor="bulk-price">
                  מחיר לכולם
                </label>
                <div className={styles.money}>
                  <span>₪</span>
                  <input
                    id="bulk-price"
                    className="fld"
                    inputMode="decimal"
                    value={bulkPrice}
                    onChange={(e) => setBulkPrice(e.target.value)}
                    placeholder="90"
                  />
                </div>
              </div>
              <button
                type="button"
                className={styles.act}
                onClick={() => void applyBulk({ price: bulkPrice })}
                disabled={busy || selectedIds.length === 0}
              >
                החלת המחיר
              </button>
            </div>
            <div className={styles.bulkFields}>
              <div className={styles.bulkField}>
                <label className="lbl" htmlFor="bulk-category">
                  קטגוריה לכולם
                </label>
                <input
                  id="bulk-category"
                  className="fld"
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  list={categoryListId}
                />
              </div>
              <button
                type="button"
                className={styles.act}
                onClick={() => void applyBulk({ categoryName: bulkCategory.trim() })}
                disabled={busy || selectedIds.length === 0}
              >
                החלת הקטגוריה
              </button>
            </div>
            <div className={styles.bulkFields}>
              <div className={styles.bulkField}>
                <label className="lbl" htmlFor="bulk-from">
                  חלון איסוף לכולם
                </label>
                <div className={styles.bulkDates}>
                  <input
                    id="bulk-from"
                    className="fld"
                    type="date"
                    value={bulkFrom}
                    onChange={(e) => setBulkFrom(e.target.value)}
                    aria-label="איסוף מתאריך לכל הנבחרים"
                  />
                  <input
                    className="fld"
                    type="date"
                    value={bulkTo}
                    onChange={(e) => setBulkTo(e.target.value)}
                    aria-label="עד תאריך לכל הנבחרים"
                  />
                </div>
              </div>
              <button
                type="button"
                className={styles.act}
                // Both ends, always: a window is validated whole, and one end
                // alone would have to be checked against each item's stored
                // other end — which this call has no way to report per item.
                onClick={() => void applyBulk({ pickupFrom: bulkFrom, pickupTo: bulkTo })}
                disabled={busy || selectedIds.length === 0}
              >
                החלת התאריכים
              </button>
            </div>
          </details>
        </div>
      )}

      <div className={styles.footer}>
        {confirming === 'batch' ? (
          <>
            <span className={styles.barCount}>למחוק את כל הייבוא, כולל התמונות?</span>
            <button
              type="button"
              className={`${styles.act} ${styles.danger}`}
              onClick={() => void handleDiscardBatch()}
              disabled={busy}
            >
              כן, למחוק הכול
            </button>
            <button type="button" className={styles.act} onClick={() => setConfirming(null)} disabled={busy}>
              ביטול
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`${styles.act} ${styles.danger}`}
              onClick={() => setConfirming('batch')}
              disabled={busy}
            >
              מחיקת כל הייבוא
            </button>
            <span className={styles.footerNote}>
              מוחק את כל הפריטים מהייבוא הזה ואת כל התמונות שלו, גם כאלה שלא שויכו לפריט.
            </span>
          </>
        )}
      </div>

      {viewing !== null && (
        // Judging whether a cluster is right means comparing its photos
        // against each other, so the arrows walk the strip rather than making
        // the seller close and reopen for every one.
        <div
          className={styles.viewer}
          role="dialog"
          aria-modal="true"
          aria-label="תצוגת תמונה"
          onClick={closeViewer}
        >
          <div className={styles.viewerBar}>
            <span>
              {viewing.index + 1} / {viewing.ids.length}
            </span>
            <button type="button" className={styles.viewerClose} onClick={closeViewer} aria-label="סגירה">
              ✕
            </button>
          </div>

          <img
            className={styles.viewerImg}
            src={photoUrl(viewing.ids[viewing.index], 1600)}
            alt=""
            onClick={(e) => e.stopPropagation()}
          />

          {viewing.ids.length > 1 && (
            <div className={styles.viewerNav} onClick={(e) => e.stopPropagation()}>
              {/* In an RTL document the arrow pointing at the NEXT photo is
                  the left one — reading order, not array order.

                  dir="ltr" on each BUTTON, not on the row: ‹ and › are
                  Bidi_Mirrored, so in an RTL context the glyphs render
                  swapped and the two arrows end up pointing at each other.
                  Putting it on .viewerNav would flip their order as well and
                  undo the positioning this comment just explained. */}
              <button type="button" dir="ltr" onClick={() => stepViewer(-1)} aria-label="התמונה הקודמת">
                ›
              </button>
              <button type="button" dir="ltr" onClick={() => stepViewer(1)} aria-label="התמונה הבאה">
                ‹
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * What the screen says once there is nothing left on it: what the whole-import
 * discard took, or what was published, or that the import was empty already.
 */
function closingLine(discarded: { items: number; photos: number } | null, published: number): string {
  if (discarded !== null) {
    const items = discarded.items === 1 ? 'פריט אחד' : `${discarded.items} פריטים`
    return `הייבוא נמחק: ${items}, ${photosLabel(discarded.photos)}.`
  }
  if (published > 0) {
    return `סיימנו. מהייבוא הזה ${published === 1 ? 'פורסם פריט אחד' : `פורסמו ${published} פריטים`}.`
  }
  return 'אין פריטים בייבוא הזה.'
}

/** Hebrew counts one thing by name, not by numeral: "1 תמונות" is wrong in a way a seller notices. */
function photosLabel(count: number): string {
  return count === 1 ? 'תמונה אחת' : `${count} תמונות`
}

/** How one item is named in a "move to…" menu: its place in the batch, plus its headline once it has one. */
function optionLabel(item: ReviewItem, index: number): string {
  const name = item.name.trim()
  return name === '' || name === DRAFT_NAME ? `פריט ${index + 1}` : `פריט ${index + 1} · ${name}`
}

/**
 * An `<input type="date">` value as the UTC-midnight Date `<PickupWindow>`
 * reads. Deliberately a local copy of `parseDate` rather than an import of
 * it: that one lives in src/lib/admin/items.ts, which pulls Prisma, and this
 * is a client component.
 */
function utcDateOrNull(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}
