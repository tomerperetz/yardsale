'use client'

import { useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { readTakenAt } from '@/lib/exif-client'
import { convertHeicIfNeeded } from '@/lib/heic-client'
import { IMPORT_CHUNK_FILES, MAX_BYTES, MAX_IMPORT_FILES } from '@/lib/photo-url'
import { clusterBatchAction } from './actions'
import adminStyles from '@/components/admin/admin.module.css'
import styles from './import.module.css'

/**
 * The front door of the AI import (spec §7.1): the seller drops a whole
 * sale's worth of photos, this uploads them and asks for the clustering, and
 * the review screen at /admin/items/import/[batchId] is where they land.
 *
 * This is the whole of /admin/items' entry half whenever ANTHROPIC_API_KEY is
 * set — page.tsx picks between it and BulkQueue.tsx, which still owns the
 * capture-time flow for when it is not. Dropping a single photo is a
 * supported use of it, and since the mode toggle went it is the only way to
 * add one item: one photo makes one cluster, which makes one draft.
 */

type Prepared = { file: File; takenAt: Date | null }

type Phase = 'idle' | 'reading' | 'uploading' | 'clustering' | 'failed'

export function ImportDrop() {
  const router = useRouter()
  const inputId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>('idle')
  const [dragOver, setDragOver] = useState(false)
  const [total, setTotal] = useState(0)
  const [landed, setLanded] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  // Set as soon as a chunk lands, and kept even when clustering then fails:
  // it is the only way back to those photos, and the review screen can both
  // retry the grouping and throw the whole import away.
  const [batchId, setBatchId] = useState<string | null>(null)

  async function handleFiles(fileList: FileList | File[]) {
    if (phase === 'reading' || phase === 'uploading' || phase === 'clustering') return

    setErrors([])
    setBatchId(null)
    setPhase('reading')

    const problems: string[] = []
    const prepared: Prepared[] = []

    for (const file of Array.from(fileList)) {
      if (prepared.length >= MAX_IMPORT_FILES) {
        problems.push(`${file.name}: יותר מדי תמונות בבת אחת. אפשר עד ${MAX_IMPORT_FILES}.`)
        continue
      }
      // Checked on the ORIGINAL file, like the rest of the admin: the server
      // enforces the same ceiling per file and reports it in the same words.
      if (file.size > MAX_BYTES) {
        problems.push(`${file.name}: הקובץ גדול מדי`)
        continue
      }
      // Capture time comes from the original file — read it before the HEIC
      // conversion below, whose canvas round-trip strips EXIF entirely. It is
      // what clusterBatch groups by when the model call cannot be made.
      const takenAt = await readTakenAt(file)
      prepared.push({ file: await convertHeicIfNeeded(file), takenAt })
    }

    if (prepared.length === 0) {
      setErrors(problems.length > 0 ? problems : ['לא נבחרו תמונות.'])
      setPhase('failed')
      return
    }

    setTotal(prepared.length)
    setLanded(0)
    setPhase('uploading')

    const { id, stored, uploadErrors } = await upload(prepared, problems, setLanded)
    setErrors(uploadErrors)

    if (id === null || stored === 0) {
      setPhase('failed')
      if (uploadErrors.length === 0) setErrors(['לא הועלתה אף תמונה.'])
      return
    }

    setBatchId(id)
    setPhase('clustering')

    const result = await clusterBatchAction(id).catch(() => ({ ok: false as const, error: 'שגיאה בקיבוץ התמונות. נסו שוב.' }))
    if (!result.ok) {
      setErrors([...uploadErrors, result.error])
      setPhase('failed')
      return
    }

    // The notice travels in the URL rather than in state so that it survives
    // the navigation and a later reload of the review screen — it is a fact
    // about this batch's import, not about this component's lifetime.
    const query = result.notice === 'NONE' ? '' : `?notice=${result.notice}`
    router.push(`/admin/items/import/${id}${query}`)
  }

  const pct = total === 0 ? 0 : Math.round((landed / total) * 100)
  const busy = phase === 'reading' || phase === 'uploading' || phase === 'clustering'

  return (
    <div>
      {phase === 'idle' || phase === 'failed' ? (
        <div
          className={dragOver ? `${adminStyles.drop} ${adminStyles.over}` : adminStyles.drop}
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
          {/* The label makes the whole hint a tap target — there is nothing to
              drag on a phone — and the input behind it stays keyboard-reachable
              because it is only visually hidden, never `hidden`. */}
          <label htmlFor={inputId} className={adminStyles.dropHint}>
            <b>גררו לכאן את כל התמונות מהמכירה או הקישו לבחירה מהגלריה</b>
            נציע חלוקה לפריטים, ולכל פריט שם ותיאור בעברית. אפשר לתקן הכול לפני שמפרסמים. עד {MAX_IMPORT_FILES} תמונות
            בייבוא אחד.
          </label>
          <div className={adminStyles.actions} style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-accent" onClick={() => fileInputRef.current?.click()}>
              בחירת תמונות
            </button>
          </div>
          <input
            id={inputId}
            ref={fileInputRef}
            type="file"
            // Exactly "image/*" — see PhotoDrop.tsx: narrowing it breaks iOS's
            // free HEIC→JPEG transcode, and a `capture` attribute would force
            // the camera and remove the gallery, which is the opposite of what
            // a seller who already photographed everything needs.
            accept="image/*"
            multiple
            className={adminStyles.visuallyHidden}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) void handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      ) : (
        <div className={styles.uploading}>
          {phase === 'reading' && <p>קוראים את התמונות…</p>}
          {phase === 'uploading' && (
            <>
              <div className={adminStyles.queueHead}>
                <span className={adminStyles.qcount}>
                  מעלים תמונות… {landed} מתוך {total}
                </span>
                <span className={adminStyles.prog}>
                  <i style={{ width: `${pct}%` }} />
                </span>
              </div>
              <p className={styles.uploadNote}>
                ההעלאה מתבצעת בקבוצות של {IMPORT_CHUNK_FILES} תמונות, אחת אחרי השנייה. אפשר להשאיר את החלון פתוח.
              </p>
            </>
          )}
          {phase === 'clustering' && (
            <>
              <p>הועלו {landed} תמונות. מקבצים אותן לפריטים וכותבים שם ותיאור לכל אחד…</p>
              <p className={styles.uploadNote}>זה יכול לקחת דקה. אל תסגרו את החלון.</p>
            </>
          )}
        </div>
      )}

      {errors.length > 0 && !busy && (
        <div className={adminStyles.errors}>
          {errors.map((error, i) => (
            <p key={i}>{error}</p>
          ))}
        </div>
      )}

      {batchId !== null && phase === 'failed' && (
        <div className={adminStyles.actions}>
          <Link href={`/admin/items/import/${batchId}`} className="btn btn-dark">
            מעבר למסך הייבוא
          </Link>
          <span className={adminStyles.sp}>התמונות שכבר הועלו שמורות שם.</span>
        </div>
      )}
    </div>
  )
}

/**
 * Posts the photos in chunks of IMPORT_CHUNK_FILES, ONE REQUEST AT A TIME.
 *
 * Sequential is not a style choice (spec §7.1): each request numbers its
 * photos from what the batch already holds, so two in flight read the same
 * count and collide. Nothing is lost, but clusterBatch reads the batch in
 * position order, so the sequence the model sees — and with it every item's
 * cover photo — is scrambled. It is also what gives the progress above its
 * cadence, and what makes a dropped connection cost one chunk instead of
 * everything.
 *
 * The first request carries no batch id and its response mints one; every
 * request after it sends that id back so its photos join the same batch. A
 * chunk that fails takes its own photos with it and the rest still stand.
 */
async function upload(
  prepared: Prepared[],
  problems: string[],
  onProgress: (landed: number) => void,
): Promise<{ id: string | null; stored: number; uploadErrors: string[] }> {
  const uploadErrors = [...problems]
  let id: string | null = null
  let stored = 0

  for (let i = 0; i < prepared.length; i += IMPORT_CHUNK_FILES) {
    const chunk = prepared.slice(i, i + IMPORT_CHUNK_FILES)

    const form = new FormData()
    // Absent on the first request, and on any retry after the first chunk
    // failed — there is no batch to join until one has actually landed.
    if (id !== null) form.append('batchId', id)
    for (const { file, takenAt } of chunk) {
      form.append('files', file)
      form.append('takenAt', (takenAt ?? new Date(file.lastModified)).toISOString())
    }

    try {
      const res = await fetch('/api/import', { method: 'POST', body: form })
      const data = (await res.json()) as {
        batchId?: string
        photos?: unknown[]
        errors?: string[]
        error?: string
      }

      if (!res.ok) {
        uploadErrors.push(data.error ?? 'ההעלאה נכשלה.')
        continue
      }

      if (typeof data.batchId === 'string') id = data.batchId
      if (data.errors) uploadErrors.push(...data.errors)
      stored += data.photos?.length ?? 0
      onProgress(stored)
    } catch {
      uploadErrors.push('ההעלאה נכשלה. בדקו את החיבור ונסו שוב.')
    }
  }

  return { id, stored, uploadErrors }
}
