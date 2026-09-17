import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The provider and the field are rendered into a real tree, so they need a
    // document. The server entry's tests declare the node environment
    // themselves, which is the environment it actually runs in.
    environment: 'happy-dom',
  },
})
