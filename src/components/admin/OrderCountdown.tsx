'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Compact `mm:ss` ticker for a PENDING_PAYMENT row in the orders table —
 * same mechanism as `HoldCountdown` (the buyer-facing full timer on
 * /pay/[token]) but sized for a table cell. At zero it calls
 * `router.refresh()` rather than guessing: the server re-sweeps expired
 * holds (`releaseExpiredHolds`) on the next render.
 */
export function OrderCountdown({ holdExpiresAt }: { holdExpiresAt: Date }) {
  const router = useRouter()
  const target = holdExpiresAt.getTime()
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, target - Date.now()))

  useEffect(() => {
    const tick = () => setRemainingMs(Math.max(0, target - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [target])

  useEffect(() => {
    if (remainingMs === 0) router.refresh()
  }, [remainingMs, router])

  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  // The server renders one second and the browser hydrates in the next, so
  // this text legitimately differs between the two. Without the suppression
  // React treats it as a corrupt tree, logs a hydration error and re-renders
  // the whole route on the client. Suppressed text is not patched, and the
  // effect's mount tick computes the same value it just rendered, so the
  // server's second stays on screen until the first interval fires — under a
  // second, on a fifteen-minute clock.
  return (
    <span dir="ltr" suppressHydrationWarning>
      {`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`}
    </span>
  )
}
