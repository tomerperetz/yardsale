/**
 * One-off: marks the items from the seller's 2026-09-15 cart screenshot as
 * שמור (RESERVED).
 *
 * Run in the deployed container, where the database actually is:
 *
 *   railway ssh npx tsx scripts/reserve-items.ts
 *   railway ssh npx tsx scripts/reserve-items.ts --apply
 *
 * Without --apply it prints what it would do and changes nothing. That is the
 * default on purpose: this edits a live shop, and the list below was read off
 * a screenshot by eye.
 *
 * Matched on name AND price, never name alone. The shop has two items called
 * "שרפרף עץ לילדים" at ₪100 and ₪30, and the screenshot shows the ₪30 one —
 * matching on the name would have reserved the wrong stool, or both.
 *
 * Every change goes through `setItemStatus`, not a raw update, so the rules
 * that protect a buyer apply here too: an item a live order is holding is
 * refused, and so is a draft or anything already sold through the shop.
 */
import { setItemStatus } from '../src/lib/admin/items'
import { db } from '../src/lib/db'

/** [name, price in shekels] exactly as they appear in the screenshot. */
const WANTED: [string, number][] = [
  ['ארגז צעצועים מעץ עם גלגלים', 100],
  ['בר מים תמי 4 פאמילי', 100],
  ['שולחן אוכל לבן עם 4 כיסאות', 300],
  ['זוג שידות לילה עם מגירה', 150],
  ['סטוקי Tripp trapp עם אביזרים נלווים', 750],
  ['שולחן מטבח איקאה לבן עם 4 כיסאות', 150],
  ['שרפרף עץ לילדים', 30],
  ['זוג מנורות שולחן', 100],
  ['מייבש כביסה', 400],
  ['מדיח כלים סימנס', 300],
  ['מכונת כביסה', 500],
  ['מיקרוגל', 100],
]

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(apply ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===')

  let reserved = 0
  const problems: string[] = []

  for (const [name, shekels] of WANTED) {
    const matches = await db.item.findMany({
      where: { name, priceAgorot: shekels * 100 },
      select: { id: true, name: true, status: true },
    })

    if (matches.length === 0) {
      problems.push(`NOT FOUND: "${name}" at ₪${shekels}`)
      continue
    }
    // Two rows with the same name and the same price is not something this
    // script may guess at. Left alone and reported.
    if (matches.length > 1) {
      problems.push(`AMBIGUOUS: "${name}" at ₪${shekels} matches ${matches.length} items`)
      continue
    }

    const item = matches[0]
    if (item.status === 'RESERVED') {
      console.log(`already reserved: ${item.name}`)
      continue
    }

    if (!apply) {
      console.log(`would reserve: ${item.name} (₪${shekels}, now ${item.status})`)
      continue
    }

    const result = await setItemStatus(item.id, 'RESERVED')
    if (result.ok) {
      console.log(`reserved: ${item.name} (₪${shekels})`)
      reserved++
    } else {
      problems.push(`REFUSED: "${item.name}" — ${result.error}`)
    }
  }

  console.log(`\n${apply ? `reserved ${reserved} item(s)` : `${WANTED.length} item(s) in the list`}`)
  if (problems.length > 0) {
    console.log('\nProblems, left untouched:')
    for (const problem of problems) console.log(`  ${problem}`)
  }

  const total = await db.item.count({ where: { status: 'RESERVED' } })
  console.log(`\nitems now RESERVED in the shop: ${total}`)
  await db.$disconnect()
}

void main()
