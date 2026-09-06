import { db } from '@/lib/db'
import { normalizeCategoryName } from '@/lib/admin/items'

export function normalizeForCompare(name: string): string {
  return normalizeCategoryName(name).replace(/^ה/, '')
}

export function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) rows[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
    }
  }
  return rows[a.length][b.length]
}

function containsAsWord(haystack: string, needle: string): boolean {
  return haystack.split(' ').includes(needle) || needle.split(' ').includes(haystack)
}

const pairKey = (a: string, b: string) => [a, b].sort().join(':')

export function suggestMerges(
  categories: { id: string; name: string }[],
  dismissed: string[],
): { aId: string; bId: string }[] {
  const out: { aId: string; bId: string }[] = []
  const skip = new Set(dismissed)

  for (let i = 0; i < categories.length; i++) {
    for (let j = i + 1; j < categories.length; j++) {
      const a = categories[i]
      const b = categories[j]
      if (skip.has(pairKey(a.id, b.id))) continue

      const na = normalizeForCompare(a.name)
      const nb = normalizeForCompare(b.name)
      const similar = na === nb || containsAsWord(na, nb) || editDistance(na, nb) <= 2
      if (similar) out.push({ aId: a.id, bId: b.id })
    }
  }
  return out
}

export async function mergeCategories(fromId: string, intoId: string): Promise<{ ok: boolean; error?: string }> {
  // Merging a category into itself reassigns its items to it — a no-op — and
  // then deletes a category its own items still point at: a foreign-key
  // violation and an unhandled 500 for the seller. Refuse it in words.
  if (fromId === intoId) return { ok: false, error: 'אי אפשר למזג קטגוריה לתוך עצמה.' }

  await db.$transaction(async (tx) => {
    await tx.item.updateMany({ where: { categoryId: fromId }, data: { categoryId: intoId } })
    await tx.category.delete({ where: { id: fromId } })
  })
  return { ok: true }
}

export async function renameCategory(id: string, rawName: string): Promise<{ ok: boolean; error?: string }> {
  const name = normalizeCategoryName(rawName)
  if (name === '') return { ok: false, error: 'צריך שם לקטגוריה.' }

  const clash = await db.category.findUnique({ where: { name } })
  if (clash && clash.id !== id) return { ok: false, error: 'כבר קיימת קטגוריה בשם הזה.' }

  await db.category.update({ where: { id }, data: { name } })
  return { ok: true }
}
