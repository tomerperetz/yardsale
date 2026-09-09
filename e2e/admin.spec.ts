import { test, expect, type Page } from '@playwright/test'
import {
  seedShop,
  makeAvailableItem,
  makeAvailableItemWithHebrewSlug,
  makeClaimedOrder,
  reserveOutOfBand,
  cleanupItems,
  cleanupOrders,
  addAdminSession,
  adminTestPassword,
} from './fixtures'

/**
 * The number in one of the four stat tiles on /admin/orders, by its label.
 * Read as a delta rather than an absolute: this suite shares one database
 * with whatever else is in it, so "the paid total went up by ₪550 and back
 * down again" is the only claim about them that can be made honestly.
 */
async function tileValue(page: Page, label: string): Promise<number> {
  const text = (await page.getByText(label, { exact: true }).locator('..').textContent()) ?? ''
  return Number(text.replace(/\D/g, ''))
}

test.describe('admin', () => {
  test.beforeEach(async () => {
    // /admin/items and /admin/orders both call getSettings() (findUniqueOrThrow),
    // so every admin test needs the Settings row to exist even when it never
    // touches the storefront itself.
    await seedShop()
  })

  test('redirects a signed-out visitor to the login page', async ({ page }) => {
    await page.goto('/admin/items')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('rejects a wrong password with the real form, then accepts the real one', async ({ page }) => {
    await page.goto('/admin/login')

    await page.getByLabel('סיסמה').fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'כניסה' }).click()
    await expect(page.getByText('סיסמה שגויה.')).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/login/)

    await page.getByLabel('סיסמה').fill(adminTestPassword())
    await page.getByRole('button', { name: 'כניסה' }).click()
    await expect(page).toHaveURL(/\/admin\/items/)
  })

  // Regression: the public header's "ניהול" button links to /admin
  // (SiteHeader.tsx), which has no page.tsx of its own — only
  // items/orders/categories/settings do. Signed out, middleware redirects
  // /admin to /admin/login and nothing is exposed. Signed IN, middleware lets
  // the request through and Next 404s on the bare /admin route, so the
  // button a signed-in seller actually clicks led nowhere. Exercised the way
  // a seller would hit it: from the public grid, through the real header link.
  test('the header admin button reaches /admin/items when signed in, not a 404', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'he-IL' })
    try {
      await addAdminSession(context)
      const page = await context.newPage()

      await page.goto('/')
      await page.getByRole('link', { name: 'ניהול' }).click()
      await expect(page).toHaveURL(/\/admin\/items/)
    } finally {
      await context.close()
    }
  })

  test('confirming a CLAIMED_PAID order marks its item sold on the storefront', async ({ browser }) => {
    const { item, order } = await makeClaimedOrder({ name: 'שולחן אוכל', price: 120000, category: 'ריהוט' })

    // A pre-signed session cookie instead of the login form — the previous
    // test already exercises that form for real; this one is about the
    // orders screen and the storefront, not login.
    const context = await browser.newContext({ locale: 'he-IL' })
    try {
      await addAdminSession(context)
      const page = await context.newPage()

      await page.goto('/admin/orders')
      const row = page.getByRole('row', { name: new RegExp(order.code) })
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: 'אישור תשלום' }).click()
      await expect(row.getByText('שולם')).toBeVisible()

      await page.goto('/')
      const card = page.locator('article.card', { hasText: item.name })
      await expect(card).toBeVisible()
      await expect(card).toContainText('נמכר')
    } finally {
      await context.close()
      await cleanupOrders([order.token])
      await cleanupItems([item.id])
    }
  })

  /**
   * The seller undoing a sale they already confirmed (spec §6): the money
   * comes off the tiles, the items go back on the shop, and the next buyer
   * can actually buy them — driven end to end rather than asserted at the
   * order row, because "back on sale" is a claim about the storefront.
   *
   * Runs at 390px too (see playwright.config.ts's mobile project), where the
   * orders table is a stack of cards and this confirmation is the longest
   * thing in one.
   */
  test('cancelling a confirmed order refunds the tiles and puts its item back on sale', async ({ browser }) => {
    const { item, order } = await makeClaimedOrder({ name: 'אופני הרים', price: 55000, category: 'ספורט' })
    const tokens: string[] = [order.token]

    const context = await browser.newContext({ locale: 'he-IL' })
    try {
      await addAdminSession(context)
      const page = await context.newPage()

      await page.goto('/admin/orders')
      const paidBefore = await tileValue(page, 'שולם עד עכשיו')
      const soldBefore = await tileValue(page, 'פריטים נמכרו')

      const row = page.getByRole('row', { name: new RegExp(order.code) })
      await row.getByRole('button', { name: 'אישור תשלום' }).click()
      await expect(row.getByText('שולם')).toBeVisible()
      await expect.poll(() => tileValue(page, 'שולם עד עכשיו')).toBe(paidBefore + 550)
      await expect.poll(() => tileValue(page, 'פריטים נמכרו')).toBe(soldBefore + 1)

      // The seller is told what this one costs before it happens: who paid,
      // how much, that the items go back on sale, and that the refund is
      // theirs to make and nothing here will chase it.
      await row.getByRole('button', { name: 'ביטול' }).click()
      await expect(row.getByText('לבטל מכירה שכבר אושרה?')).toBeVisible()
      await expect(row).toContainText('קונה קלוד')
      await expect(row).toContainText('₪550')
      await expect(row).toContainText('יחזיר את הפריטים למכירה')
      await expect(row).toContainText('האתר לא עוקב אחרי החזרים')

      await row.getByRole('button', { name: 'כן, לבטל ולהחזיר את הכסף' }).click()
      await expect(row.getByText('בוטל')).toBeVisible()
      await expect.poll(() => tileValue(page, 'שולם עד עכשיו')).toBe(paidBefore)
      await expect.poll(() => tileValue(page, 'פריטים נמכרו')).toBe(soldBefore)

      // The refund is the only thing left to say, so the row keeps the one
      // way this app has of saying it.
      await expect(row.getByRole('link', { name: 'וואטסאפ' })).toBeVisible()

      // And the item is genuinely for sale again — not merely un-greyed.
      await page.goto('/')
      const card = page.locator('article.card', { hasText: item.name })
      await expect(card).toBeVisible()
      await expect(card).not.toHaveClass(/sold/)

      await page.getByText(item.name).click()
      await page.getByRole('button', { name: 'הוספה לסל' }).click()
      await page.goto('/cart')
      await page.getByRole('link', { name: 'המשך לפרטים ואיסוף' }).click()
      await page.getByLabel('שם מלא').fill('קונה שני')
      await page.getByLabel('טלפון').fill('052-741-8830')
      await page.getByRole('button', { name: '15', exact: true }).click()
      await page.getByRole('button', { name: 'אחה״צ' }).click()
      await page.getByRole('button', { name: 'שריון הפריטים והמשך' }).click()

      await expect(page).toHaveURL(/\/pay\//)
      tokens.push(page.url().split('/pay/')[1]?.split(/[/?#]/)[0] ?? '')
    } finally {
      await context.close()
      await cleanupOrders(tokens)
      await cleanupItems([item.id])
    }
  })

  test('the seller can mark a saved item sold from its edit screen, and put it back', async ({ browser }) => {
    const item = await makeAvailableItem({ name: 'כורסת קריאה', price: 33000, category: 'ריהוט' })

    const context = await browser.newContext({ locale: 'he-IL' })
    try {
      await addAdminSession(context)
      const page = await context.newPage()

      await page.goto(`/admin/items/${item.id}`)
      await page.getByRole('button', { name: 'נמכר', exact: true }).click()

      // The storefront is the assertion that matters — the seller marks it sold
      // so that buyers stop trying to buy it.
      await page.goto('/')
      const card = page.locator('article.card', { hasText: item.name })
      await expect(card).toContainText('נמכר')

      await page.goto(`/admin/items/${item.id}`)
      await page.getByRole('button', { name: 'זמין למכירה', exact: true }).click()

      await page.goto('/')
      await expect(page.locator('article.card', { hasText: item.name })).not.toHaveClass(/sold/)
    } finally {
      await context.close()
      await cleanupItems([item.id])
    }
  })

  test('hiding an item pulls it from the shop, and unhiding restores the same URL', async ({ browser }) => {
    const item = await makeAvailableItemWithHebrewSlug({ name: 'שידת מגירות', price: 44000, category: 'ריהוט' })

    const context = await browser.newContext({ locale: 'he-IL' })
    try {
      await addAdminSession(context)
      const page = await context.newPage()

      // The link a buyer would already have shared.
      const itemUrl = `/item/${item.slug}`
      await page.goto(itemUrl)
      await expect(page.getByRole('heading', { name: item.name })).toBeVisible()

      await page.goto(`/admin/items/${item.id}`)
      await page.getByRole('button', { name: 'מוסתר', exact: true }).click()
      await expect(page.getByText('הפריט ירד מהחנות')).toBeVisible()

      // Gone from the grid, and the shared link no longer resolves.
      await page.goto('/')
      await expect(page.locator('article.card', { hasText: item.name })).toHaveCount(0)
      const hiddenResponse = await page.goto(itemUrl)
      expect(hiddenResponse?.status()).toBe(404)

      await page.goto(`/admin/items/${item.id}`)
      await page.getByRole('button', { name: 'זמין למכירה', exact: true }).click()

      // Back in the grid, and — the point of HIDDEN over DRAFT — at the very
      // same URL, so the link people already shared works again.
      await page.goto('/')
      await expect(page.locator('article.card', { hasText: item.name })).toHaveCount(1)
      const backResponse = await page.goto(itemUrl)
      expect(backResponse?.status()).toBe(200)
      await expect(page.getByRole('heading', { name: item.name })).toBeVisible()
    } finally {
      await context.close()
      await cleanupItems([item.id])
    }
  })

  test('an item a live order is holding offers the seller no status buttons', async ({ browser }) => {
    const item = await makeAvailableItem({ name: 'מדף ספרים', price: 21000, category: 'ריהוט' })
    const reservation = await reserveOutOfBand(item.id)

    const context = await browser.newContext({ locale: 'he-IL' })
    try {
      await addAdminSession(context)
      const page = await context.newPage()

      await page.goto(`/admin/items/${item.id}`)
      await expect(page.getByText('שמור להזמנה פעילה')).toBeVisible()
      await expect(page.getByRole('button', { name: 'נמכר', exact: true })).toHaveCount(0)
    } finally {
      await context.close()
      await cleanupOrders([reservation.token])
      await cleanupItems([item.id])
    }
  })
})
