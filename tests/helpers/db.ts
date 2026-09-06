import { db } from '@/lib/db'

export async function resetDb() {
  await db.orderItem.deleteMany()
  await db.order.deleteMany()
  await db.photo.deleteMany()
  await db.item.deleteMany()
  await db.category.deleteMany()
  await db.settings.deleteMany()
}
