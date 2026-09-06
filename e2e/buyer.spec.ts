import { test, expect } from '@playwright/test'
import { seedShop, makeAvailableItem, reserveOutOfBand, cleanupItems, cleanupOrders } from './fixtures'

test.describe('buyer journey', () => {
  test.beforeEach(async () => {
    await seedShop()
  })

  test('a buyer can filter, add to cart and reach the payment page', async ({ page }) => {
    const sofa = await makeAvailableItem({ name: 'ספה תלת מושבית', price: 85000, category: 'ריהוט' })
    const mixer = await makeAvailableItem({ name: 'מיקסר שולחני', price: 45000, category: 'מטבח' })
    const tokens: string[] = []

    try {
      await page.goto('/')
      await expect(page.getByText(sofa.name)).toBeVisible()

      // Filtering to "מטבח" hides the sofa (it's in "ריהוט").
      await page.getByRole('link', { name: 'מטבח', exact: true }).click()
      await expect(page).toHaveURL(/category=/)
      await expect(page.getByText(sofa.name)).toHaveCount(0)

      await page.getByRole('link', { name: 'הכל' }).click()
      await page.getByText(sofa.name).click()
      await expect(page).toHaveURL(/\/item\//)

      await page.getByRole('button', { name: 'הוספה לסל' }).click()

      // A hard navigation to /cart, not the modal's own close button: this
      // also proves the cart (browser localStorage only, see
      // CartProvider.tsx) survives a full page reload, not just client nav.
      await page.goto('/cart')
      await expect(page.getByText(sofa.name)).toBeVisible()
      await page.getByRole('link', { name: 'המשך לפרטים ואיסוף' }).click()
      await expect(page).toHaveURL(/\/checkout/)

      await page.getByLabel('שם מלא').fill('מיכל אברהמי')
      await page.getByLabel('טלפון').fill('052-741-8830')
      // exact:true is required — see accessible-names.md's digit-collision
      // note: a slot chip showing configured hours like "15:00–18:00" also
      // contains "15", which would make a substring match ambiguous.
      await page.getByRole('button', { name: '15', exact: true }).click()
      await page.getByRole('button', { name: 'אחה״צ' }).click()
      await page.getByRole('button', { name: 'שריון הפריטים והמשך' }).click()

      await expect(page).toHaveURL(/\/pay\//)
      // The order code renders twice on this page (the copy field and the
      // instructions), so .first() avoids a strict-mode ambiguity.
      await expect(page.getByText(/YS-\d{4}/).first()).toBeVisible()

      tokens.push(page.url().split('/pay/')[1]?.split(/[/?#]/)[0] ?? '')
    } finally {
      await cleanupOrders(tokens)
      await cleanupItems([sofa.id, mixer.id])
    }
  })

  // The most important test in this suite. Two checkouts race for one item;
  // exactly one may win. If this ever passes with both buyers reaching
  // /pay/, the reservation logic (src/lib/orders/reserve.ts) is broken and
  // nothing else here can be trusted.
  test('a race is reported to the loser, not silently oversold', async ({ page }) => {
    const bike = await makeAvailableItem({ name: 'אופני הרים', price: 62000, category: 'ספורט' })
    const tokens: string[] = []

    try {
      await page.goto('/')
      await page.getByText(bike.name).click()
      await expect(page).toHaveURL(/\/item\//)
      await page.getByRole('button', { name: 'הוספה לסל' }).click()

      await page.goto('/cart')
      await page.getByRole('link', { name: 'המשך לפרטים ואיסוף' }).click()
      await expect(page).toHaveURL(/\/checkout/)

      await page.getByLabel('שם מלא').fill('קונה שני')
      await page.getByLabel('טלפון').fill('054-330-1192')
      await page.getByRole('button', { name: '15', exact: true }).click()
      await page.getByRole('button', { name: 'אחה״צ' }).click()

      // Somebody else checks out — for real, through reserveItems — while
      // this buyer's form sits filled in but not yet submitted.
      const winner = await reserveOutOfBand(bike.id)
      tokens.push(winner.token)

      await page.getByRole('button', { name: 'שריון הפריטים והמשך' }).click()

      await expect(page.getByText('חלק מהפריטים נתפסו בינתיים.')).toBeVisible()
      // Not just "something was taken" — named which item, scoped to the
      // unavailable-items list so it can't match the item's own line above it.
      await expect(page.locator('.unavailable-list')).toContainText(bike.name)
      await expect(page).not.toHaveURL(/\/pay\//)
    } finally {
      await cleanupOrders(tokens)
      await cleanupItems([bike.id])
    }
  })

  test('the shop refuses orders until the BIT number is set', async ({ page }) => {
    await seedShop({ bitPhone: '' })
    const lamp = await makeAvailableItem({ name: 'מנורה', price: 9000, category: 'ריהוט' })

    try {
      await page.goto('/')
      await page.getByText(lamp.name).click()
      await expect(page).toHaveURL(/\/item\//)
      await page.getByRole('button', { name: 'הוספה לסל' }).click()

      await page.goto('/cart')
      await expect(page.getByText('החנות עדיין לא פתוחה להזמנות')).toBeVisible()
    } finally {
      await cleanupItems([lamp.id])
    }
  })
})
