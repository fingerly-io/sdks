import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineWorkspace } from 'vitest/config'

/**
 * Two projects, because a component has two builds and this package cares
 * about both.
 *
 * The difference is one line - which `svelte` a module resolves to - and it is
 * not cosmetic: with the browser condition forced, a server render reaches
 * `setContext` from Svelte's *client* internals and throws
 * `lifecycle_outside_component`. Which is exactly the failure a SvelteKit app
 * would hit, so it is worth a project rather than a workaround.
 */
export default defineWorkspace([
  {
    plugins: [svelte({ hot: false })],
    // The browser build, because these tests mount components into a document.
    resolve: { conditions: ['browser'] },
    test: {
      name: 'dom',
      environment: 'happy-dom',
      include: ['tests/binding.test.ts'],
    },
  },
  {
    plugins: [svelte({ hot: false })],
    // No browser condition: this is the server build, rendering to a string.
    test: {
      name: 'ssr',
      environment: 'node',
      include: ['tests/ssr.test.ts'],
    },
  },
])
