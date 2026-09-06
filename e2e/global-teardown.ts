import { seedShop } from './fixtures'

/**
 * The last spec to run in this suite (buyer.spec.ts's "shop refuses orders"
 * test) deliberately leaves Settings.bitPhone empty to prove the shop
 * closes. Settings is a single shared row (see fixtures.ts's seedShop), so
 * leaving it closed would surprise anyone else on this machine poking at
 * the app right after a run. Reopen it once, suite-wide, when everything
 * else is done.
 */
export default async function globalTeardown() {
  await seedShop()
}
