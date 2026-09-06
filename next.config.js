// In production, refuse to boot without the secrets the app needs to run
// safely — most importantly ADMIN_PASSWORD_HASH and SESSION_SECRET, since
// starting without them would mean an admin area with no real password check
// or a session cookie no one can verify.
for (const key of ['DATABASE_URL', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET']) {
  if (process.env.NODE_ENV === 'production' && !process.env[key]) {
    throw new Error(`${key} is required in production`)
  }
}

/** @type {import('next').NextConfig} */
module.exports = { output: 'standalone' }
