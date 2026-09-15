import { db } from '../src/lib/db'
import { hebrewSlug, randomSuffix } from '../src/lib/slug'
import { STARTER_CATEGORIES } from '../src/lib/starter-categories'

export async function seed() {
  await db.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      shopName: '',
      tagline: '',
      bitPhone: '',
      addressLine: '',
      city: '',
      slotMorning: '',
      slotAfternoon: '',
      slotEvening: '',
    },
  })

  // Keyed on the name, which is the unique column the rest of the app looks a
  // category up by: running the seed twice, or running it against a shop that
  // already has ריהוט, must not create a second one.
  for (const name of STARTER_CATEGORIES) {
    await db.category.upsert({
      where: { name },
      update: {},
      create: { name, slug: hebrewSlug(name, randomSuffix()) },
    })
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed().then(() => db.$disconnect())
}
