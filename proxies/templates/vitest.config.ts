import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The nginx and Caddy suites start real containers; image pulls and start-up
    // take longer than the default five seconds.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
})
