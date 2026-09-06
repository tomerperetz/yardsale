'use client'

import { useId, useRef, useState } from 'react'
import { readTakenAt } from '@/lib/exif-client'
import { convertHeicIfNeeded } from '@/lib/heic-client'
import { removePhotoAction, reorderPhotosAction } from '@/app/admin/items/actions'
import styles from './admin.module.css'

export type PhotoInfo = { id: string; width: number; height: number; lqip: string; position: number }

// Mirrors src/lib/images.ts (MAX_BYTES, MAX_PHOTOS_PER_ITEM) — that module
// imports sharp and cannot run in a client component, so the numbers are
// duplicated here purely to give the seller instant feedback. The upload
// route enforces the real limits server-side regardless.
const MAX_BYTES = 12 * 1024 * 1024
const MAX_PHOTOS_PER_ITEM = 10
// Mirrors MAX_REQUEST_BYTES in src/app/api/upload/route.ts. Per-file and
// per-item-count checks above don't catch a batch of several large photos
// whose combined size still exceeds the request cap — exactly the case a
// phone upload over mobile data is most likely to hit, so it's worth
// refusing locally before spending the upload rather than after.
const MAX_REQUEST_BYTES = 64 * 1024 * 1024

/** `${photoId}-${width}.webp`, inlined because src/lib/images.ts (sharp) can't be imported client-side. */
function photoSrc(itemId: string, photoId: string, width: 400 | 800 | 1600 = 400): string {
  return `/img/${itemId}/${photoId}-${width}.webp`
}

/**
 * Photo manager for one item — drag-and-drop on desktop, tap-to-open-the-
 * gallery on a phone (there's nothing to drag on a touchscreen). Uploads
 * straight to POST /api/upload, shows a grid with a "ראשי" marker on the
 * first photo, lets the seller remove or drag-reorder, and surfaces
 * per-file upload errors (never a single all-or-nothing toast — a batch of
 * ten photos where nine succeed and one fails is the normal case).
 */
export function PhotoDrop({
  itemId,
  photos,
  onPhotosChange,
}: {
  itemId: string
  photos: PhotoInfo[]
  onPhotosChange: (photos: PhotoInfo[]) => void
}) {
  const inputId = useId()
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draggedId = useRef<string | null>(null)

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    const available = MAX_PHOTOS_PER_ITEM - photos.length
    const localErrors: string[] = []
    const accepted: File[] = []

    for (const file of files) {
      if (accepted.length >= available) {
        localErrors.push(`${file.name}: הפריט כבר מכיל ${MAX_PHOTOS_PER_ITEM} תמונות`)
        continue
      }
      if (file.size > MAX_BYTES) {
        localErrors.push(`${file.name}: הקובץ גדול מדי`)
        continue
      }
      accepted.push(file)
    }

    if (accepted.length === 0) {
      setErrors(localErrors)
      return
    }

    setUploading(true)

    // Read capture time and convert HEIC BEFORE the total-size check below —
    // that check must sum the bytes actually about to be sent (i.e. after
    // HEIC conversion), not the original files' sizes.
    const prepared: { file: File; takenAt: Date | null }[] = []
    for (const file of accepted) {
      // Read the capture time from the ORIGINAL file before any HEIC
      // conversion — the canvas round-trip strips EXIF entirely.
      const takenAt = await readTakenAt(file)
      // HEIC layer 2 (see src/lib/heic-client.ts): converts in-browser when
      // needed and possible; returns the original file untouched otherwise,
      // so the upload always proceeds and layer 3 (the server's own HEIC
      // error) is the final fallback rather than anything failing here.
      const uploadFile = await convertHeicIfNeeded(file)
      prepared.push({ file: uploadFile, takenAt })
    }

    const totalBytes = prepared.reduce((sum, p) => sum + p.file.size, 0)
    if (totalBytes > MAX_REQUEST_BYTES) {
      setErrors([...localErrors, 'הבקשה גדולה מדי. נסו להעלות פחות תמונות בבת אחת.'])
      setUploading(false)
      return
    }

    const form = new FormData()
    form.append('itemId', itemId)
    for (const { file, takenAt } of prepared) {
      form.append('files', file)
      form.append('takenAt', takenAt ? takenAt.toISOString() : new Date(file.lastModified).toISOString())
    }

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = (await res.json()) as {
        photos?: { id: string; width: number; height: number; lqip: string }[]
        errors?: string[]
        error?: string
      }
      if (!res.ok) {
        setErrors([...localErrors, data.error ?? 'ההעלאה נכשלה. נסו שוב.'])
        return
      }
      const uploaded = data.photos ?? []
      const newPhotos: PhotoInfo[] = uploaded.map((p, i) => ({ ...p, position: photos.length + i }))
      onPhotosChange([...photos, ...newPhotos])
      setErrors([...localErrors, ...(data.errors ?? [])])
    } catch {
      setErrors([...localErrors, 'ההעלאה נכשלה. בדקו את החיבור ונסו שוב.'])
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove(photoId: string) {
    onPhotosChange(photos.filter((p) => p.id !== photoId))
    await removePhotoAction(itemId, photoId)
  }

  function handleDropReorder(targetId: string) {
    const fromId = draggedId.current
    draggedId.current = null
    if (!fromId || fromId === targetId) return

    const next = [...photos]
    const fromIndex = next.findIndex((p) => p.id === fromId)
    const toIndex = next.findIndex((p) => p.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return

    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    const reindexed = next.map((p, i) => ({ ...p, position: i }))
    onPhotosChange(reindexed)
    void reorderPhotosAction(reindexed.map((p) => p.id))
  }

  return (
    <div>
      <div
        className={dragOver ? `${styles.drop} ${styles.over}` : styles.drop}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files)
        }}
      >
        <div className={styles.shots}>
          {photos.map((p, i) => (
            <div
              key={p.id}
              className={i === 0 ? `${styles.shot} ${styles.first}` : styles.shot}
              draggable
              onDragStart={() => {
                draggedId.current = p.id
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                handleDropReorder(p.id)
              }}
            >
              <img src={photoSrc(itemId, p.id)} alt="" style={{ backgroundImage: `url(${p.lqip})` }} />
              <button type="button" className={styles.rm} onClick={() => handleRemove(p.id)} aria-label="הסרת תמונה">
                ✕
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS_PER_ITEM && (
            <button
              type="button"
              className={`${styles.shot} ${styles.add}`}
              onClick={() => fileInputRef.current?.click()}
              aria-label="הוספת תמונות"
              disabled={uploading}
            >
              +
            </button>
          )}
        </div>
        {/* The whole hint block doubles as a tap target on a phone — there's
            nothing to drag on a touchscreen — via the native <label>/<input>
            association, which keeps the real input reachable by keyboard
            (Tab lands on it directly; it's only visually hidden, not
            `hidden`) as well as by tap, with no JS needed for either. */}
        <label htmlFor={inputId} className={styles.dropHint}>
          <b>{uploading ? 'מעלה תמונות…' : 'גררו תמונות לכאן או הקישו לבחירה'}</b>
          הראשונה היא התמונה הראשית. אפשר לגרור כדי לסדר מחדש.
        </label>
        <input
          id={inputId}
          ref={fileInputRef}
          type="file"
          // Deliberately exactly "image/*" — do not narrow this to specific
          // MIME types or extensions, and do not add a `capture` attribute.
          // `capture` forces the camera and removes the gallery option,
          // which is backwards for a seller who already photographed
          // everything. Narrowing `accept` away from "image/*" would also
          // stop iOS Safari from transcoding a HEIC photo to JPEG on the
          // way out of the picker — that free conversion (HEIC handling
          // layer 1) depends on this attribute staying exactly this broad.
          accept="image/*"
          multiple
          className={styles.visuallyHidden}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {errors.length > 0 && (
        <div className={styles.errors}>
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}
    </div>
  )
}
