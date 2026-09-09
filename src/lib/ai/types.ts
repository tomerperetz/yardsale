/**
 * What a Claude call can return, for callers that must degrade rather than
 * throw. Spec §7.4 is the contract: every one of these has a defined
 * behaviour on the import path, and none of them may reach the buyer.
 *
 * `OUT_OF_CREDIT` is deliberately not folded into `FAILED`. The account
 * behind ANTHROPIC_API_KEY will run dry mid-import one day, and that outcome
 * is latched per batch — once seen, the batch stops calling — so it has to be
 * distinguishable from a network blip, which is worth retrying next import.
 */
export type AiFailure = 'NO_KEY' | 'OUT_OF_CREDIT' | 'FAILED'

export type AiResult<T> = { ok: true; value: T } | { ok: false; reason: AiFailure }

/** The Hebrew copy for one item. `category` is '' when none of the seller's fits. */
/**
 * `category` is either one of the seller's existing names, verbatim, or a name
 * the model proposed because none of theirs fitted, or empty when it could not
 * tell from the photographs.
 *
 * `categoryIsNew` is what keeps a proposal from arriving disguised as an
 * existing category: the seller sees it flagged and can accept, rename, or
 * swap before it exists. Without that, a first import quietly fills the
 * buyer's filter bar with near-duplicates that each hide the other's items.
 */
export type Caption = {
  headline: string
  description: string
  category: string
  categoryIsNew: boolean
}
