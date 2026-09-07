'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Ticks down to `holdExpiresAt` — the only reason /pay/[token] needs client
 * JS. It never guesses what happens at zero: it calls `router.refresh()` so
 * the server re-sweeps expired holds (see `releaseExpiredHolds`) and
 * re-renders whichever state the order is really in.
 *
 * Styling lifted from docs/design/mockups/02-buyer-flow.html, panel 3
 * ("תשלום בביט").
 */
export function HoldCountdown({ holdExpiresAt }: { holdExpiresAt: Date }) {
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

  return (
    <div className="timer">
      {/* See OrderCountdown: server and client render different seconds, which
          is not a corrupt tree. Suppressed so React hydrates instead of
          discarding the server HTML for the route. */}
      <span className="clock" dir="ltr" suppressHydrationWarning>
        {`${minutes}:${String(seconds).padStart(2, '0')}`}
      </span>
      <span className="t">
        <b>הפריטים שמורים לך</b>
        אם לא תאשרו תשלום עד אז, הם יחזרו למכירה
      </span>
    </div>
  )
}
