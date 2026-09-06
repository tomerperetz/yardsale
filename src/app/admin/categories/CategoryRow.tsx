'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { renameCategoryAction } from './actions'
import adminStyles from '@/components/admin/admin.module.css'
import styles from './categories.module.css'

/** One category tile: name, item count, and an inline rename toggle. */
export function CategoryRow({ id, name, count }: { id: string; name: string; count: number }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setPending(true)
    setError(null)
    const result = await renameCategoryAction(id, value)
    setPending(false)
    if (!result.ok) {
      setError(result.error ?? null)
      return
    }
    setEditing(false)
    router.refresh()
  }

  if (editing) {
    return (
      <div className={styles.catrowEdit}>
        <div className={styles.catEditRow}>
          <label className={adminStyles.visuallyHidden} htmlFor={`cat-name-${id}`}>
            שם הקטגוריה
          </label>
          <input
            id={`cat-name-${id}`}
            className={styles.catInput}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <button type="button" className={styles.ed} onClick={save} disabled={pending} aria-label="שמירת שם הקטגוריה">
            {pending ? '…' : '✓'}
          </button>
          <button
            type="button"
            className={styles.ed}
            disabled={pending}
            aria-label="ביטול עריכת שם הקטגוריה"
            onClick={() => {
              setEditing(false)
              setValue(name)
              setError(null)
            }}
          >
            ✕
          </button>
        </div>
        {error && <p className={styles.catError}>{error}</p>}
      </div>
    )
  }

  return (
    <div className={styles.catrow}>
      <b>{name}</b>
      <span className={styles.n}>{count}</span>
      <button type="button" className={styles.ed} onClick={() => setEditing(true)} aria-label={`עריכת קטגוריה ${name}`}>
        ✎
      </button>
    </div>
  )
}
