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
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Explicit rather than relying on Next's own standalone .env copying
    // (which is undocumented behaviour, not a guarantee) — dotenv above
    // already populated process.env in this (parent) process, so the
    // spawned build+start subprocess inherits it here regardless.
    env: process.env as Record<string, string>,
  },
})
