/**
 * The production secrets check deliberately does NOT live here. See
 * src/instrumentation.ts: this file is loaded by `next build`, which needs no
 * database and no admin password, and it is NOT loaded by the standalone
 * server, which needs both. A guard here fails the wrong thing and protects
 * nothing.
 */

/** @type {import('next').NextConfig} */
module.exports = { output: 'standalone' }
