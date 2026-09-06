import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    // Stays 'node' — Prisma cannot run under jsdom, and most tests in this
    // project are database tests. Component tests opt in per file with a
    // `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup-env.ts'],
    // Db tests share one real Postgres instance with no per-file isolation;
    // each file's `resetDb()` would otherwise race another file's in-flight
    // rows. Run test files one at a time to keep them deterministic.
    fileParallelism: false,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
