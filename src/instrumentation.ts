/**
 * The production environment check, at the only moment it can actually do its
 * job: server startup.
 *
 * This guard used to live in next.config.js, which was wrong in both
 * directions. `next build` loads that file, so a build with no database URL
 * failed even though building needs no database — that is what broke the first
 * Railway deploy. And the standalone server never loads it at all: `next build`
 * inlines the resolved config into .next/standalone/server.js as a JSON
 * literal, so the guard that existed to "refuse to boot without a real admin
 * password" was not running at boot, ever. It only blocked builds.
 *
 * Next calls `register()` once per server process, and it is bundled into the
 * standalone output, so this runs on Railway exactly when it should.
 */

const REQUIRED = ['DATABASE_URL', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET'] as const

export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return
  // Next runs `register` in the edge runtime too, where process.exit does not
  // exist and these variables are not the ones that matter.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const missing = REQUIRED.filter((key) => !process.env[key])
  if (missing.length === 0) return

  console.error(
    `Refusing to start: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.\n` +
      'Serving the shop without these would mean an admin area with no real password check, ' +
      'or a session cookie nobody can verify. Set them on the service and redeploy.',
  )
  process.exit(1)
}
