'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import type { ReactNode } from 'react'

/**
 * Wraps `ItemDetail` when it renders inside the `@modal` intercepting route.
 * The backdrop, the close button and Escape all go back to wherever the
 * buyer came from — closing the overlay without losing the grid's filters,
 * since it's the same history entry that put them there.
 */
export function QuickLookModal({ children }: { children: ReactNode }) {
  const router = useRouter()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.back()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [router])

  return (
    <div className="modal-backdrop" onClick={() => router.back()}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="nav">
          <h4>מבט מהיר</h4>
          <button type="button" className="x" onClick={() => router.back()} aria-label="סגירה">
            ✕
          </button>
        </div>
        <div className="modal-scroll">{children}</div>
      </div>
    </div>
  )
}
