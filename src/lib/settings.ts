import type { Settings } from '@prisma/client'
import { db } from '@/lib/db'

export type ShopSettings = Awaited<ReturnType<typeof getSettings>>

/** Fields the seller must fill before the shop is usable. `tagline` is optional. */
const REQUIRED = ['shopName', 'bitPhone', 'addressLine', 'city'] as const

export async function getSettings(): Promise<Settings> {
  return db.settings.findUniqueOrThrow({ where: { id: 1 } })
}

/** No BIT number means a buyer could reserve items with no way to pay. */
export function shopIsOpen(s: Pick<Settings, 'bitPhone'>): boolean {
  return s.bitPhone.trim() !== ''
}

export function missingSettings(s: Settings): string[] {
  return REQUIRED.filter((k) => s[k].trim() === '')
}
