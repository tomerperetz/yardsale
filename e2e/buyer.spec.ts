import { test, expect } from '@playwright/test'
import {
  seedShop,
  makeAvailableItem,
  makeAvailableItemWithHebrewSlug,
  makeCancelledOrder,
  reserveOutOfBand,
  cleanupItems,
  cleanupOrders,
} from './fixtures'

test.describe('buyer journey', () => {
  test.beforeEach(async () => {
    await seedShop()
  })

  // Regression for task-14 fix round 2: every real item page 404'd, because
  // the route never decoded params.slug — Next hands it over still
  // percent-encoded, and a Hebrew slug is never ASCII-identical to its own
  // percent-encoding the way this suite's other, ASCII-slugged fixture items
  // happen to be. Asserting only `toHaveURL(/\/item\//)` (as the rest of
  // this file already did) is exactly why it shipped: the URL was right and
  // the page underneath it was a 404. This asserts the item's name is
  // actually rendered, through both the quick-look overlay (a soft
  // navigation, intercepted by @modal) and the standalone page (a hard
  // navigation/reload) — two separate route files, either of which could
  // regress independently.
  test('a hebrew-slugged item page renders instead of 404ing', async ({ page }) => {
    const chair = await makeAvailableItemWithHebrewSlug({ name: 'כיסא נדנדה', price: 32000, category: 'ריהוט' })

    try {
      await page.goto('/')
      await page.getByText(chair.name).click()
      await expect(page).toHaveURL(/\/item\//)
      // Scoped to the dialog: the grid card behind the overlay repeats the
      // same name, so an unscoped getByText would match both and fail on
      // strict-mode ambiguity even when the overlay itself is correct.
      await expect(page.getByRole('dialog').getByText(chair.name)).toBeVisible()

      // A hard navigation/reload drops the grid entirely — only the
      // standalone /item/[slug] page (no @modal overlay) is on screen now.
      await page.reload()
      await expect(page.getByText(chair.name)).toBeVisible()
    } finally {
      await cleanupItems([chair.id])
    }
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

  /**
   * The buyer's two own pages, after the seller cancelled a sale they had
   * already confirmed. `/pay/[token]` is the bookmark — it used to fall
   * through to "ההזמנה פגה", telling someone who is owed a refund that they
   * timed out, which is the one thing that did not happen. Neither page can
   * promise when the money comes back (nothing here tracks it), so both say
   * only what happened and who will be in touch.
   */
  test('a buyer whose paid order was cancelled reads about the refund, not an expiry', async ({ page }) => {
    const { item, order } = await makeCancelledOrder({
      name: 'תנור אפייה',
      price: 45000,
      category: 'מטבח',
      paidFirst: true,
    })

    try {
      await page.goto(`/pay/${order.token}`)
      await expect(page.getByText('ההזמנה בוטלה אחרי שהתשלום אושר')).toBeVisible()
      await expect(page.getByText('ההזמנה פגה')).toHaveCount(0)

      await page.getByRole('link', { name: 'לצפייה בהזמנה' }).click()
      await expect(page).toHaveURL(new RegExp(`/o/${order.token}`))
      await expect(page.getByText('המוכר/ת יחזרו אליכם לגבי ההחזר')).toBeVisible()
    } finally {
      await cleanupOrders([order.token])
      await cleanupItems([item.id])
    }
  })

  test('a buyer whose unpaid order was cancelled is promised no refund', async ({ page }) => {
    const { item, order } = await makeCancelledOrder({
      name: 'שידה לבנה',
      price: 28000,
      category: 'ריהוט',
      paidFirst: false,
    })

    try {
      for (const url of [`/pay/${order.token}`, `/o/${order.token}`]) {
        await page.goto(url)
        await expect(page.getByText('ההזמנה בוטלה והפריטים חזרו למכירה')).toBeVisible()
        await expect(page.getByText('החזר')).toHaveCount(0)
      }
    } finally {
      await cleanupOrders([order.token])
      await cleanupItems([item.id])
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
