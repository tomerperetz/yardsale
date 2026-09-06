'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readTakenAt } from '@/lib/exif-client'
import { groupByCaptureTime, type PhotoStamp } from '@/lib/exif'
import { createItemAction } from '@/app/admin/items/actions'
import styles from './admin.module.css'

// Mirrors src/lib/images.ts (MAX_BYTES, MAX_PHOTOS_PER_ITEM) — see PhotoDrop.tsx.
const MAX_BYTES = 12 * 1024 * 1024
const MAX_PHOTOS_PER_ITEM = 10

type Group = { id: string; keys: string[] }
type UploadResult = { successCount: number; errors: string[] }

/**
 * Bulk photo intake: drop a whole camera roll, get a PROPOSED grouping from
 * groupByCaptureTime (consecutive shots taken seconds apart = one object),
 * fix any wrong guesses with a split/merge before anything is written, then
 * walk the queue one item at a time — each step creates and publishes one
 * item and uploads its group's photos to it.
 */
export function BulkQueue({
  categories,
  initialCategory,
  initialPickupFrom,
  initialPickupTo,
}: {
  categories: string[]
  initialCategory: string
  initialPickupFrom: string
  initialPickupTo: string
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const filesByKey = useRef<Map<string, File>>(new Map())
  const takenAtByKey = useRef<Map<string, Date | null>>(new Map())
  const urlByKey = useRef<Map<string, string>>(new Map())

  const [stage, setStage] = useState<'drop' | 'review' | 'walk' | 'done'>('drop')
  const [groups, setGroups] = useState<Group[]>([])
  const [reading, setReading] = useState(false)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [phase, setPhase] = useState<'entering' | 'result'>('entering')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState(initialCategory)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<UploadResult | null>(null)
  const [createdCount, setCreatedCount] = useState(0)

  useEffect(() => {
    return () => {
      urlByKey.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  function urlFor(key: string): string {
    let url = urlByKey.current.get(key)
    if (!url) {
      const file = filesByKey.current.get(key)
      if (!file) return ''
      url = URL.createObjectURL(file)
      urlByKey.current.set(key, url)
    }
    return url
  }

  async function handleFiles(fileList: FileList | File[]) {
    setReading(true)
    const stamps: PhotoStamp[] = []
    for (const file of Array.from(fileList)) {
      const key = crypto.randomUUID()
      filesByKey.current.set(key, file)
      const takenAt = await readTakenAt(file)
      takenAtByKey.current.set(key, takenAt)
      stamps.push({ key, takenAt, lastModified: file.lastModified })
    }
    const proposed = groupByCaptureTime(stamps)
    setGroups(proposed.map((keys) => ({ id: crypto.randomUUID(), keys })))
    setReading(false)
    setStage('review')
  }

  function splitGroup(index: number) {
    setGroups((prev) => {
      const next = [...prev]
      const [group] = next.splice(index, 1)
      next.splice(index, 0, ...group.keys.map((k) => ({ id: crypto.randomUUID(), keys: [k] })))
      return next
    })
  }

  function mergeGroups(index: number) {
    setGroups((prev) => {
      if (index + 1 >= prev.length) return prev
      const next = [...prev]
      const [a] = next.splice(index, 1)
      next[index] = { id: a.id, keys: [...a.keys, ...next[index].keys] }
      return next
    })
  }

  function startWalking() {
    setStage('walk')
    setCurrentIndex(0)
    setPhase('entering')
    setName('')
    setPrice('')
    setError(null)
    setLastResult(null)
    setCreatedCount(0)
  }

  const flatKeys = useMemo(() => groups.flatMap((g) => g.keys), [groups])
  const keyGroupIndex = useMemo(() => {
    const m = new Map<string, number>()
    groups.forEach((g, i) => g.keys.forEach((k) => m.set(k, i)))
    return m
  }, [groups])

  const currentGroup = groups[currentIndex]
  const isLast = currentIndex + 1 >= groups.length

  async function handleNext() {
    if (!currentGroup || pending) return

    if (phase === 'result') {
      if (isLast) {
        setStage('done')
        router.refresh()
        return
      }
      setCurrentIndex((i) => i + 1)
      setPhase('entering')
      setName('')
      setPrice('')
      setError(null)
      setLastResult(null)
      return
    }

    setPending(true)
    setError(null)

    const created = await createItemAction({
      name,
      description: '',
      price,
      categoryName: category,
      pickupFrom: initialPickupFrom,
      pickupTo: initialPickupTo,
      photoIds: [],
      publish: true,
    })
    if (!created.ok) {
      setPending(false)
      setError(created.error)
      return
    }
    setCreatedCount((n) => n + 1)

    const localErrors: string[] = []
    const keysToUpload: string[] = []
    for (const key of currentGroup.keys) {
      const file = filesByKey.current.get(key)
      if (!file) continue
      if (keysToUpload.length >= MAX_PHOTOS_PER_ITEM) {
        localErrors.push(`${file.name}: הפריט כבר מכיל ${MAX_PHOTOS_PER_ITEM} תמונות`)
        continue
      }
      if (file.size > MAX_BYTES) {
        localErrors.push(`${file.name}: הקובץ גדול מדי`)
        continue
      }
      keysToUpload.push(key)
    }

    let uploadResult: UploadResult = { successCount: 0, errors: localErrors }
    if (keysToUpload.length > 0) {
      const form = new FormData()
      form.append('itemId', created.id)
      for (const key of keysToUpload) {
        const file = filesByKey.current.get(key)
        if (!file) continue
        form.append('files', file)
        const takenAt = takenAtByKey.current.get(key)
        form.append('takenAt', takenAt ? takenAt.toISOString() : new Date(file.lastModified).toISOString())
      }
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: form })
        const data = (await res.json()) as { photos?: unknown[]; errors?: string[]; error?: string }
        uploadResult = res.ok
          ? { successCount: data.photos?.length ?? 0, errors: [...localErrors, ...(data.errors ?? [])] }
          : { successCount: 0, errors: [...localErrors, data.error ?? 'ההעלאה נכשלה.'] }
      } catch {
        uploadResult = { successCount: 0, errors: [...localErrors, 'ההעלאה נכשלה. בדקו את החיבור ונסו שוב.'] }
      }
    }

    setLastResult(uploadResult)
    setPending(false)
    setPhase('result')
  }

  return (
    <div>
      {stage === 'drop' && (
        <div
          className={styles.drop}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files)
          }}
        >
          <div className={styles.dropHint}>
            <b>{reading ? 'קוראים את התמונות…' : 'גררו לכאן את כל התמונות מהמצלמה'}</b>
            אפשר לבחור כמה תמונות בבת אחת. נזהה אוטומטית אילו תמונות שייכות לאותו פריט.
          </div>
          <div className={styles.actions} style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-accent" onClick={() => fileInputRef.current?.click()} disabled={reading}>
              בחירת תמונות
            </button>
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
      )}

      {stage === 'review' && (
        <div>
          <p className={styles.hint} style={{ display: 'block', marginBlockEnd: 12 }}>
            {groups.length} פריטים מוצעים מתוך {flatKeys.length} תמונות. אפשר לפצל קבוצה שגויה או לאחד שתי קבוצות סמוכות
            לפני שנוצר כלום.
          </p>
          <div className={styles.groups}>
            {groups.map((g, i) => (
              <div key={g.id}>
                <div className={styles.group}>
                  <div className={styles.groupHead}>
                    <b>
                      פריט {i + 1} · {g.keys.length} תמונות
                    </b>
                    <span className={styles.sp} />
                    <button
                      type="button"
                      className={styles.smallbtn}
                      onClick={() => splitGroup(i)}
                      disabled={g.keys.length < 2}
                    >
                      פיצול
                    </button>
                  </div>
                  <div className={styles.groupShots}>
                    {g.keys.map((k) => (
                      <img key={k} src={urlFor(k)} alt="" />
                    ))}
                  </div>
                </div>
                {i < groups.length - 1 && (
                  <div className={styles.between}>
                    <button type="button" className={styles.smallbtn} onClick={() => mergeGroups(i)}>
                      איחוד עם הקבוצה הבאה
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btn-accent" onClick={startWalking} disabled={groups.length === 0}>
              המשך למילוי פרטים
            </button>
          </div>
        </div>
      )}

      {stage === 'walk' && currentGroup && (
        <div>
          <div className={styles.queueHead}>
            <span className={styles.qcount}>
              פריט {currentIndex + 1} מתוך {groups.length}
            </span>
            <span className={styles.prog}>
              <i style={{ width: `${(currentIndex / groups.length) * 100}%` }} />
            </span>
            <span className={styles.qcount} style={{ color: 'var(--ink-3)' }}>
              {groups.length - currentIndex - 1} נותרו
            </span>
          </div>

          <div className={styles.film}>
            {flatKeys.map((k) => {
              const gi = keyGroupIndex.get(k) ?? -1
              const extra = gi < currentIndex ? styles.done : gi === currentIndex ? styles.now : undefined
              return (
                <div key={k} className={extra}>
                  <img src={urlFor(k)} alt="" />
                </div>
              )
            })}
          </div>

          {error && (
            <div className={styles.errors}>
              <p>{error}</p>
            </div>
          )}

          <div className={styles.qrow}>
            <img src={urlFor(currentGroup.keys[0])} alt="" />
            <div>
              <label className="lbl" htmlFor="bulk-name">
                שם
              </label>
              <input
                id="bulk-name"
                className="fld"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="מנורת קריאה"
                disabled={phase === 'result'}
              />
            </div>
            <div>
              <label className="lbl" htmlFor="bulk-price">
                מחיר
              </label>
              <div className={styles.money}>
                <span>₪</span>
                <input
                  id="bulk-price"
                  className="fld"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="90"
                  disabled={phase === 'result'}
                />
              </div>
            </div>
            <div>
              <label className="lbl">
                קטגוריה <span className={styles.carry}>נשמר</span>
              </label>
              <input
                className="fld"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="bulk-categories"
                disabled={phase === 'result'}
              />
              <datalist id="bulk-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <button
              type="button"
              className="btn btn-dark"
              disabled={pending || (phase === 'entering' && (!name.trim() || !price.trim()))}
              onClick={handleNext}
            >
              {pending ? 'שומר…' : phase === 'result' && isLast ? 'סיום' : 'הבא ←'}
            </button>
          </div>

          {lastResult && (
            <div className={styles.result}>
              <p>
                {lastResult.successCount > 0
                  ? `הועלו ${lastResult.successCount} תמונות בהצלחה.`
                  : 'לא הועלתה אף תמונה עבור הפריט הזה.'}
              </p>
              {lastResult.errors.length > 0 && (
                <div className={styles.resultErrors}>
                  {lastResult.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {stage === 'done' && (
        <div className={styles.done}>
          <p>נוצרו {createdCount} פריטים חדשים.</p>
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => {
              filesByKey.current.clear()
              takenAtByKey.current.clear()
              urlByKey.current.forEach((url) => URL.revokeObjectURL(url))
              urlByKey.current.clear()
              setGroups([])
              setCreatedCount(0)
              setStage('drop')
            }}
          >
            העלאת קבוצה נוספת
          </button>
        </div>
      )}
    </div>
  )
}
