'use client'

import { useActionState } from 'react'
import { declarePaid } from './actions'

/**
 * The one interactive control on the payment page besides the copy
 * buttons. `declarePaid` returns a complete Hebrew sentence on every
 * outcome — EXPIRED, NOT_FOUND, and an already-claimed double-tap all
 * read as sentences, not error codes — so this just renders whatever
 * comes back. On success it returns null and `revalidatePath` re-renders
 * the page in its CLAIMED_PAID state; nothing here needs to redirect.
 *
 * Split out from `page.tsx` (an async Server Component) because
 * `useActionState` needs a Client Component.
 */
export function PayForm({ token }: { token: string }) {
  const [message, formAction, isPending] = useActionState(declarePaid, null)

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      {message && <p className="pay-note">{message}</p>}
      <div className="foot-btn">
        <button type="submit" className="btn-primary btn-accent" disabled={isPending}>
          שילמתי בביט
        </button>
        <p className="after">אחרי הלחיצה הפריטים נשארים שמורים עד שנאשר את ההעברה, ותקבלו הודעה בוואטסאפ עם הכתובת.</p>
      </div>
    </form>
  )
}
