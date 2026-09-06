'use client'

import { useRef, useState } from 'react'
import { readTakenAt } from '@/lib/exif-client'
import { removePhotoAction, reorderPhotosAction } from '@/app/admin/items/actions'
import styles from './admin.module.css'

export type PhotoInfo = { id: string; width: number; height: number; lqip: string; position: number }

// Mirrors src/lib/images.ts (MAX_BYTES, MAX_PHOTOS_PER_ITEM) — that module
// imports sharp and cannot run in a client component, so the numbers are
// duplicated here purely to give the seller instant feedback. The upload
// route enforces the real limits server-side regardless.
const MAX_BYTES = 12 * 1024 * 1024
const MAX_PHOTOS_PER_ITEM = 10

/** `${photoId}-${width}.webp`, inlined because src/lib/images.ts (sharp) can't be imported client-side. */
function photoSrc(itemId: string, photoId: string, width: 400 | 800 | 1600 = 400): string {
  return `/img/${itemId}/${photoId}-${width}.webp`
}

/**
 * Drag-and-drop photo manager for one item: uploads straight to
 * POST /api/upload, shows a grid with a "ראשי" marker on the first photo,
 * lets the seller remove or drag-reorder, and surfaces per-file upload
 * errors (never a single all-or-nothing toast — a batch of ten photos
 * where nine succeed and one fails is the normal case).
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
    const form = new FormData()
    form.append('itemId', itemId)
    for (const file of accepted) {
      form.append('files', file)
      const takenAt = await readTakenAt(file)
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
        <div className={styles.dropHint}>
          <b>{uploading ? 'מעלה תמונות…' : 'גררו תמונות לכאן'}</b>
          הראשונה היא התמונה הראשית. אפשר לגרור כדי לסדר מחדש.
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
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
