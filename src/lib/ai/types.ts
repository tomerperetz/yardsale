/**
 * What a Claude call can return, for callers that must degrade rather than
 * throw. Spec §7.4 is the contract: every one of these has a defined
 * behaviour on the import path, and none of them may reach the buyer.
 *
 * `OUT_OF_CREDIT` is deliberately not folded into `FAILED`. The account
 * behind ANTHROPIC_API_KEY will run dry mid-import one day, and that outcome
 * is latched per batch — once seen, the batch stops calling — so it has to be
 * distinguishable from a network blip, which is worth retrying next import.
 *
 * `UNAVAILABLE` and `FAILED` split on one question: did the model answer?
 *
 *   UNAVAILABLE — the call never completed. A 500, a 529 overloaded, a
 *   connection reset, DNS. This says nothing whatsoever about the item.
 *   FAILED — the model answered and the answer was unusable: a grouping that
 *   did not account for the photos, a listing that was not a listing.
 *   Something about this item, or these photographs, or the prompt.
 *
 * The distinction earns its keep in `rewriteDescriptions`, which counts an
 * item's failures and retires it after two. Counting an outage would let
 * twenty minutes of Anthropic 529s permanently retire every item in the shop
 * from a feature whose whole purpose is those items — and nothing in the app
 * resets that counter. Before the split, `classify()` flattened every
 * transport error into FAILED and the two were indistinguishable downstream.
 */
export type AiFailure = 'NO_KEY' | 'OUT_OF_CREDIT' | 'UNAVAILABLE' | 'FAILED'

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
  /**
   * A suggested asking price in agorot, already rounded to the nearest ₪50,
   * or 0 for "the model would not price it".
   *
   * Zero is a real answer and not a missing one: the model is told to return
   * it rather than guess at an object it cannot identify, and 0 is also what
   * an unpriced draft already holds — so the import path writes it without a
   * special case, and the review screen goes on showing an empty price field
   * and refusing to publish until the seller fills it.
   */
  priceAgorot: number
}
