/**
 * Lists items that look like duplicates, so the seller can see what to delete
 * before deleting anything.
 *
 *   railway ssh npx tsx scripts/find-duplicates.ts
 *
 * Read-only. It groups by name — the shop genuinely has two different stools
 * both called "שרפרף עץ לילדים" at different prices, so an exact-name match is
 * a candidate to look at, never an instruction.
 */
import { db } from '../src/lib/db'

async function main() {
  const items = await db.item.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      priceAgorot: true,
      status: true,
      createdAt: true,
      _count: { select: { photos: true, orderItems: true } },
    },
  })

  const byName = new Map<string, typeof items>()
  for (const item of items) {
    const key = item.name.trim()
    byName.set(key, [...(byName.get(key) ?? []), item])
  }

  const groups = [...byName.entries()].filter(([, rows]) => rows.length > 1)
  if (groups.length === 0) {
    console.log('No two items share a name.')
  }

  for (const [name, rows] of groups) {
    console.log(`\n"${name}" — ${rows.length} items`)
    for (const row of rows) {
      const blocked = row._count.orderItems > 0 ? '  [ON AN ORDER — cannot be deleted]' : ''
      console.log(
        `  ₪${row.priceAgorot / 100}  ${row.status}  ${row._count.photos} photo(s)  ` +
          `added ${row.createdAt.toISOString().slice(0, 16).replace('T', ' ')}${blocked}`,
      )
    }
  }

  console.log(`\n${items.length} items total, ${groups.length} name(s) used more than once.`)
  await db.$disconnect()
}

void main()
