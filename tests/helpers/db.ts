import { db } from '@/lib/db'

export async function resetDb() {
  // Before items: Event cascades on item delete, but a shop-wide event has no
  // item to cascade from and would survive into the next test. The first four
  // tests that hit this counted the previous test's visitors.
  await db.event.deleteMany()
  await db.orderItem.deleteMany()
  await db.order.deleteMany()
  await db.photo.deleteMany()
  await db.item.deleteMany()
  await db.category.deleteMany()
  await db.settings.deleteMany()
}
