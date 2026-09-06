import type { Settings } from '@prisma/client'
import { db } from '@/lib/db'

export type ShopSettings = Awaited<ReturnType<typeof getSettings>>

/** Fields the seller must fill before the shop is usable. `tagline` is optional. */
const REQUIRED = ['shopName', 'bitPhone', 'addressLine', 'city'] as const

/**
 * What the shop looks like before the seller has saved anything — and what it
 * falls back to if the row is ever missing (a failed pre-deploy, a restore, a
 * stray delete). Every field empty is a state the app already renders
 * correctly: `shopIsOpen` is false, `missingSettings` lists everything, and
 * checkout refuses with SHOP_NOT_OPEN. Degrading into first-run keeps
 * /admin/settings reachable, which is the only place the seller can fix it.
 */
function emptySettings(): Settings {
  return {
    id: 1,
    shopName: '',
    tagline: '',
    bitPhone: '',
    addressLine: '',
    city: '',
    slotMorning: '',
    slotAfternoon: '',
    slotEvening: '',
    holdMinutes: 15,
    dismissedMerges: [],
  }
}

/**
 * Deliberately `findFirst` + a default rather than `findUniqueOrThrow`: a
 * missing row must not 500 every server-rendered page, including the settings
 * screen itself. This never creates the row — a read must not write; the row
 * is created by `saveSettingsAction` when the seller saves.
 */
export async function getSettings(): Promise<Settings> {
  return (await db.settings.findFirst()) ?? emptySettings()
}

/** No BIT number means a buyer could reserve items with no way to pay. */
export function shopIsOpen(s: Pick<Settings, 'bitPhone'>): boolean {
  return s.bitPhone.trim() !== ''
}

export function missingSettings(s: Settings): string[] {
  return REQUIRED.filter((k) => s[k].trim() === '')
}
