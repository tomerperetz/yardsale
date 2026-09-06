/**
 * The ONLY place in the codebase that may emit a numeric range.
 *
 * In an RTL paragraph a bare "12–18" renders as "18–12": Unicode bidi rule N1
 * resolves the neutral dash between two numbers as right-to-left, splitting the
 * range into two separately-ordered runs. dir="ltr" isolates it.
 */
export function Range({ from, to }: { from: string | number; to: string | number }) {
  if (String(from) === String(to)) return <span dir="ltr">{from}</span>
  return (
    <span dir="ltr">
      {from}–{to}
    </span>
  )
}
