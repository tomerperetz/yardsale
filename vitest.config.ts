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
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
