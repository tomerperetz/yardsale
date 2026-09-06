import { db } from '../src/lib/db'

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
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed().then(() => db.$disconnect())
}
