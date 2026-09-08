import 'dotenv/config'
import { defineConfig, devices } from '@playwright/test'

// The real, built app — not `next dev`. `postbuild` (package.json) copies
// `.next/static` and `public/` into `.next/standalone/`, which Next's
// `output: 'standalone'` does not do on its own; without that copy the
// standalone server boots and renders HTML, but every `/_next/static/*`
// asset 404s and the page never hydrates.
export const BASE_URL = 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  // NOT fullyParallel, and pinned to a single worker: Settings (see
  // prisma/schema.prisma) is a singleton row shared by the whole database,
  // and every test's seedShop() reads/writes it — two tests running at once
  // (even across the two projects below) can flip bitPhone or hours out
  // from under each other. This suite trades speed for a database it does
  // not get to isolate per test.
  workers: 1,
  forbidOnly: !!process.env.CI,
  // The race spec's whole point is two real concurrent requests; retries
  // would hide a flaky implementation instead of surfacing it.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'he-IL',
    trace: 'retain-on-failure',
  },
  // The product owner requirement is explicit: the shop must work on phones
  // for buyers AND sellers. Both projects run the full suite (buyer and
  // admin) rather than splitting by device, because nothing in this app is
  // actually desktop-only — the admin tables render as responsive
  // `data-label` cards (see items.module.css / orders.module.css).
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], locale: 'he-IL' },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        locale: 'he-IL',
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    // /admin/login, not BASE_URL itself: readiness only needs "the process
    // is up and Next is serving," and `/` calls getSettings()
    // (findUniqueOrThrow) — on a database shared with other concurrent work,
    // a Settings row that's momentarily missing (see fixtures.ts's seedShop)
    // would 500 that check and stall the whole run for 180s over something
    // this suite already handles per-test. /admin/login renders with no DB
    // read at all.
    url: `${BASE_URL}/admin/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Explicit rather than relying on Next's own standalone .env copying
    // (which is undocumented behaviour, not a guarantee) — dotenv above
    // already populated process.env in this (parent) process, so the
    // spawned build+start subprocess inherits it here regardless.
    //
    // ANTHROPIC_API_KEY is blanked on purpose, whatever the developer running
    // this has in their .env. The key is optional (spec §11) and its absence
    // is a fully specified path, not a broken one: clustering falls back to
    // capture time and no copy is generated (spec §7.4, first row). Pinning it
    // empty is what makes import.spec.ts deterministic — a real clustering
    // call would group by what is in the photographs, so no assertion about
    // which item holds which photo could survive it — and it keeps the suite
    // off the network and off the product owner's API credit. Prompt quality
    // is checked the way spec §10 asks, against a model, not from here.
    //
    // This applies to a server THIS CONFIG STARTS. `reuseExistingServer` above
    // hands the run whatever is already on 3000, environment and all, so a
    // developer with a keyed dev server up gets a keyed server and this line
    // never runs. import.spec.ts closes that hole from its end: it is
    // `mode: 'serial'` and its first test asserts the feature is off, so a
    // keyed server skips every test that would have called the API rather
    // than billing someone for the discovery.
    env: { ...(process.env as Record<string, string>), ANTHROPIC_API_KEY: '' },
  },
})
