import { test, expect } from '@playwright/test'
import { seedShop, makeClaimedOrder, cleanupItems, cleanupOrders, addAdminSession, adminTestPassword } from './fixtures'

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
})
