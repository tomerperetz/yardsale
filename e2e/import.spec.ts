import { test, expect } from '@playwright/test'
import { db } from '../src/lib/db'
import { photoUrl } from '../src/lib/photo-url'
import { seedShop, addAdminSession, dropImportPhotos, cleanupImportBatch } from './fixtures'

/**
 * The AI import, end to end (spec §7, plan task 9).
 *
 * It runs with ANTHROPIC_API_KEY blanked — playwright.config.ts pins it that
 * way for every developer, whatever their .env holds. That is not a reduced
 * version of the feature: the key is optional (spec §11) and its absence is
 * one of §7.4's specified paths, where clustering falls back to capture-time
 * grouping and no copy is generated. It is also the only path a test can make
 * assertions about — a real clustering call groups by what is in the
 * photographs, so which photo lands on which item would be the model's
 * decision, not the fixture's — and it keeps the suite off the network and off
 * the product owner's API credit. Prompt quality is checked against a model,
 * the way spec §10 asks, not from here.
 *
 * So the photos are posted the way ImportDrop's own upload() posts them (see
 * `dropImportPhotos`), because the drop zone itself is only rendered when the
 * key is set. Everything after the drop — the review screen, the move menu,
 * the bulk bar, publishing, the discard — is the real UI, driven the way the
 * seller drives it.
 *
 * Capture times are chosen to produce a known grouping: `groupByCaptureTime`
 * puts consecutive photos within 30 seconds of each other in one group.
 */

/** 3 September 2026, 09:00 UTC, plus `seconds` — the moment a photo was taken. */
function takenAt(seconds: number): Date {
  return new Date(Date.UTC(2026, 8, 3, 9, 0, seconds))
}

/** `count` photos, each `gap` seconds after the last, starting at `from`. */
function shots(count: number, from: number, gap = 5) {
  return Array.from({ length: count }, (_, i) => ({ takenAt: takenAt(from + i * gap) }))
}

test.describe('ai import', () => {
  test.beforeEach(async () => {
    // Every /admin page and the storefront both call getSettings()
    // (findUniqueOrThrow), so the singleton has to exist.
    await seedShop()
  })

  test('the bulk tab says the automatic naming is off when no key is configured', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'he-IL' })
    try {
      await addAdminSession(context)
      const page = await context.newPage()

      await page.goto('/admin/items?mode=bulk')

      // Spec §7.4, first row: no key means no call is attempted and the seller
      // is told so, rather than being offered a feature that cannot run.
      await expect(page.getByText('הזיהוי האוטומטי כבוי כרגע')).toBeVisible()
    } finally {
      await context.close()
    }
  })

  // Regression, and the reason `dropImportPhotos` posts one chunk at a time:
  // each request numbers its photos from what the batch already holds, so two
  // in flight read the same count and give their photos colliding positions
  // (spec §7.1). Nothing is lost — every photo still gets an item — but the
  // batch's order is scrambled, and with it every item's cover photo. Nine
  // photos is the smallest drop that crosses the six-per-request boundary.
  test('a drop of nine photos lands in one batch, numbered in the order it was dropped', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'he-IL' })
    let batchId: string | undefined
    try {
      await addAdminSession(context)
      const page = await context.newPage()
      await page.goto('/admin/items?mode=bulk')

      // Five seconds apart, so capture-time grouping proposes exactly one item
      // and the whole batch is one photo strip to read the order off.
      const drop = await dropImportPhotos(page, shots(9, 0))
      batchId = drop.batchId

      expect(drop.chunks).toBe(2)
      expect(drop.photoIds).toHaveLength(9)

      const stored = await db.photo.findMany({
        where: { importBatchId: batchId },
        orderBy: { position: 'asc' },
        select: { id: true, position: true },
      })
      expect(stored.map((photo) => photo.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
      expect(stored.map((photo) => photo.id)).toEqual(drop.photoIds)

      await page.goto(`/admin/items/import/${batchId}`)
      await expect(page.getByText('9 תמונות עדיין לא שויכו לפריט.')).toBeVisible()

      // Regression, and the state that showed it: nine photos still waiting to
      // be grouped is the widest this screen ever gets. The strip is meant to
      // scroll inside itself, but the <main> holding it is a grid item sized by
      // its content, so on a 390px phone the whole admin went out to 1026px and
      // took the button below off the side of the screen — where the seller
      // could not tap it and this test could not click it either. See
      // items.module.css's .shell.
      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth)

      await page.getByRole('button', { name: 'קיבוץ התמונות שנותרו לפריטים' }).click()

      // The degradation the whole spec runs under, said in Hebrew on the screen
      // (spec §7.4). If this line is missing, the server under test had a key
      // after all — see playwright.config.ts.
      await expect(page.getByText('לא יצרנו שמות ותיאורים אוטומטיים לייבוא הזה')).toBeVisible()

      const card = page.locator('article')
      await expect(card).toHaveCount(1)
      await expect(card).toContainText('9 תמונות')

      // The order that survived the chunk boundary, as the seller sees it: the
      // first photo dropped is the first in the strip, which is the cover.
      const sources = await card.locator('img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')))
      expect(sources).toEqual(drop.photoIds.map((id) => photoUrl(id)))
    } finally {
      // Never fatal: a test that timed out mid-action closes with a throw, and
      // an import that skipped its cleanup leaves rows in a database this suite
      // shares AND files on disk that nothing points at.
      await context.close().catch(() => {})
      await cleanupImportBatch(batchId)
    }
  })

  test('the seller moves a photo, dates the selection, and publishes it to the shop', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'he-IL' })
    let batchId: string | undefined
    try {
      await addAdminSession(context)
      const page = await context.newPage()
      await page.goto('/admin/items?mode=bulk')

      // Two capture-time clusters of three: 09:00:00-09:00:10, then twenty
      // minutes later. The gap is what splits them.
      const drop = await dropImportPhotos(page, [...shots(3, 0), ...shots(3, 1200)])
      batchId = drop.batchId

      await page.goto(`/admin/items/import/${batchId}`)
      await page.getByRole('button', { name: 'קיבוץ התמונות שנותרו לפריטים' }).click()

      const cards = page.locator('article')
      await expect(cards).toHaveCount(2)
      await expect(cards.nth(0)).toContainText('3 תמונות')
      await expect(cards.nth(1)).toContainText('3 תמונות')

      // The correction the review screen exists for: clustering put a photo
      // with the wrong thing, and the seller moves it. The fourth photo of the
      // drop is the second item's cover; it belongs to the first item.
      await cards.nth(1).getByLabel('העברת התמונה לפריט').first().selectOption({ label: 'פריט 1' })

      await expect(cards.nth(0)).toContainText('4 תמונות')
      await expect(cards.nth(1)).toContainText('2 תמונות')

      // Appended, never inserted: the item it moved to keeps the cover it had.
      const moved = await cards.nth(0).locator('img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')))
      expect(moved).toEqual([drop.photoIds[0], drop.photoIds[1], drop.photoIds[2], drop.photoIds[3]].map((id) => photoUrl(id)))

      // Unique per run: this database is shared with the unit suite and with
      // the other project (desktop/mobile), and the storefront assertions
      // below find these items by name.
      const stamp = `${Date.now()}-${process.pid}`
      const sofa = `ספה מהייבוא ${stamp}`
      const lamp = `מנורה מהייבוא ${stamp}`
      await cards.nth(0).getByLabel('שם הפריט').fill(sofa)
      await cards.nth(1).getByLabel('שם הפריט').fill(lamp)

      // Both cards start selected — the seller's usual next move is one price,
      // one window and one publish over the whole drop.
      await page.getByText('בחירה ועריכה של כל הנבחרים').click()

      await page.getByLabel('מחיר לכולם').fill('90')
      await page.getByRole('button', { name: 'החלת המחיר' }).click()
      await expect(page.getByText('עודכנו 2 פריטים.')).toBeVisible()

      await page.getByLabel('איסוף מתאריך לכל הנבחרים').fill('2026-10-05')
      await page.getByLabel('עד תאריך לכל הנבחרים').fill('2026-10-09')
      await page.getByRole('button', { name: 'החלת התאריכים' }).click()

      // One edit, both cards — and direction-isolated, so the window reads
      // 5–9 and not 9–5.
      await expect(cards.nth(0)).toContainText('5–9 באוקטובר')
      await expect(cards.nth(1)).toContainText('5–9 באוקטובר')

      await page.getByRole('button', { name: 'פרסום' }).click()

      // Published items leave the review: they are real listings now.
      await expect(page.getByText('סיימנו. מהייבוא הזה פורסמו 2 פריטים.')).toBeVisible()

      await page.goto('/')

      const sofaCard = page.locator('article.card', { hasText: sofa })
      await expect(sofaCard).toBeVisible()
      await expect(sofaCard).toContainText('5–9 באוקטובר')
      // The right photos: the cover of the shop card is the first photo of the
      // item as the review screen left it, moved photo and all.
      await expect(sofaCard.locator('img')).toHaveAttribute('src', photoUrl(drop.photoIds[0], 800))

      const lampCard = page.locator('article.card', { hasText: lamp })
      await expect(lampCard).toBeVisible()
      await expect(lampCard.locator('img')).toHaveAttribute('src', photoUrl(drop.photoIds[4], 800))
    } finally {
      // Never fatal: a test that timed out mid-action closes with a throw, and
      // an import that skipped its cleanup leaves rows in a database this suite
      // shares AND files on disk that nothing points at.
      await context.close().catch(() => {})
      await cleanupImportBatch(batchId)
    }
  })

  // Spec §7.3, "Discarding the batch, not just its items": between /api/import
  // writing a photo and clusterBatch attaching it, that photo belongs to no
  // item at all, so an item-keyed discard cannot reach it and no screen can
  // show it. This is the control that can.
  test('discarding the whole import takes the photos that never reached an item', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'he-IL' })
    let batchId: string | undefined
    try {
      await addAdminSession(context)
      const page = await context.newPage()
      await page.goto('/admin/items?mode=bulk')

      const clustered = await dropImportPhotos(page, shots(3, 0))
      batchId = clustered.batchId

      await page.goto(`/admin/items/import/${batchId}`)
      await page.getByRole('button', { name: 'קיבוץ התמונות שנותרו לפריטים' }).click()
      await expect(page.locator('article')).toHaveCount(1)

      // Two more photos into the same batch, never grouped — the seller who
      // closed the tab while clustering was still to come.
      const loose = await dropImportPhotos(page, shots(2, 3600), batchId)
      await page.reload()
      await expect(page.getByText('2 תמונות עדיין לא שויכו לפריט.')).toBeVisible()

      // On disk before the discard, so the 404 below means the files went, not
      // that they were never written.
      expect((await page.request.get(photoUrl(loose.photoIds[0]))).status()).toBe(200)

      await page.getByRole('button', { name: 'מחיקת כל הייבוא' }).click()
      await page.getByRole('button', { name: 'כן, למחוק הכול' }).click()

      // The counts are the point: one item, and all five photos — the three on
      // it and the two that were on nothing.
      await expect(page.getByText('הייבוא נמחק: פריט אחד, 5 תמונות.')).toBeVisible()

      expect(await db.item.count({ where: { importBatchId: batchId } })).toBe(0)
      expect(await db.photo.count({ where: { importBatchId: batchId } })).toBe(0)
      expect((await page.request.get(photoUrl(loose.photoIds[0]))).status()).toBe(404)
    } finally {
      // Never fatal: a test that timed out mid-action closes with a throw, and
      // an import that skipped its cleanup leaves rows in a database this suite
      // shares AND files on disk that nothing points at.
      await context.close().catch(() => {})
      await cleanupImportBatch(batchId)
    }
  })
})
