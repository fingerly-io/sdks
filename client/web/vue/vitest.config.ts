import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The composables mount real components, so they need a document. happy-dom
    // rather than jsdom because it starts in a few milliseconds and nothing
    // here exercises the parts where the two differ.
    environment: 'happy-dom',
  },
})
