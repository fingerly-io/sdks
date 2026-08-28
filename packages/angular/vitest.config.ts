import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // TestBed builds a real application injector and runs real render hooks,
    // so it needs a document.
    environment: 'happy-dom',
    setupFiles: ['tests/setup.ts'],
  },
})
