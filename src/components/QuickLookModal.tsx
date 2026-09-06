'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Wraps `ItemDetail` when it renders inside the `@modal` intercepting route.
 * The backdrop, the close button and Escape all go back to wherever the
 * buyer came from — closing the overlay without losing the grid's filters,
 * since it's the same history entry that put them there.
 *
 * This is a real dialog, not just a styled div: it's labelled by the item's
 * name (`titleId`, an id `ItemDetail` puts on its `<h2>`), focus moves onto
 * the close button when it opens, Tab/Shift+Tab are trapped inside the panel
 * so a keyboard user can't walk out into the grid cards still mounted behind
 * it, and focus returns to whatever triggered the overlay when it closes.
 */
export function QuickLookModal({ children, titleId }: { children: ReactNode; titleId: string }) {
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        router.back()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [router])

  return (
    <div className="modal-backdrop" onClick={() => router.back()}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nav">
          <h4>מבט מהיר</h4>
          <button ref={closeRef} type="button" className="x" onClick={() => router.back()} aria-label="סגירה">
            ✕
          </button>
        </div>
        <div className="modal-scroll">{children}</div>
      </div>
    </div>
  )
}
