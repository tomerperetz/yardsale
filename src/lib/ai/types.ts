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
 * There is deliberately no "is this new" flag here. The review screen answers
 * that from the database — a category no item outside this batch belongs to —
 * which stays true when the seller edits the field, and stops being true when
 * the category earns an item of its own. A flag carried from the caption call
 * would only describe what the model said at the time, and nothing would keep
 * the two in step. See the spec's §3.5 and tests/db/new-categories.test.ts.
 */
export type Caption = {
  headline: string
  description: string
  category: string
}
