/** Israeli mobile prefixes: 050-059, ten digits total. */
const MOBILE = /^05\d{8}$/

export function normalizeIsraeliMobile(raw: string): string | null {
  let digits = raw.replace(/[\s()-]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  if (digits.startsWith('972')) digits = `0${digits.slice(3)}`
  return MOBILE.test(digits) ? digits : null
}

export function toInternational(local: string): string {
  return `972${local.slice(1)}`
}
