const shekelFormatter = new Intl.NumberFormat('he-IL', {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
})

/**
 * Renders integer agorot as the shekel string the design uses, e.g. 85000 -> "₪850".
 *
 * The sign is applied here rather than via `style: 'currency'` on purpose: the
 * he-IL CLDR currency pattern is "‏850 ₪" (sign last, RLM-prefixed), and the
 * approved mockups put the sign first. Grouping still comes from Intl.
 */
export function formatAgorot(agorot: number): string {
  return `₪${shekelFormatter.format(Math.round(agorot / 100))}`
}

export function shekelsToAgorot(shekels: number): number {
  return Math.round(shekels * 100)
}

/** Parses seller input into agorot. Returns null for anything that is not a non-negative number. */
export function parseShekelInput(raw: string): number | null {
  const cleaned = raw.replace(/[₪,\s]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return shekelsToAgorot(n)
}
