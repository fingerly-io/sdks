import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

/**
 * The playground: the binding driving the real SDK in a real browser.
 *
 * Served rather than opened from disk because several sources need a secure
 * context and `file://` is not one - the incognito signal is the clearest
 * case, since the probe it rests on is not exposed outside one. `localhost`
 * counts as secure.
 *
 * Port 4176, so this, the React demo on 4175, the Vue demo on 4174 and the
 * web-js demo on 4173 can be open beside each other.
 */
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [svelte()],
  server: { port: 4176 },
  preview: { port: 4176 },
})
