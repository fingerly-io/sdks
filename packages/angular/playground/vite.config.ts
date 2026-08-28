import { defineConfig } from 'vite'

/**
 * The playground: the binding driving the real SDK in a real browser.
 *
 * No Angular CLI. The application is compiled just-in-time by
 * `@angular/compiler` in the page, which is enough to prove the binding works
 * in a real Angular application without pulling a second build system into
 * this workspace for one demo.
 *
 * Served rather than opened from disk because several sources need a secure
 * context and `file://` is not one - the incognito verdict is the clearest
 * case, since the probe it rests on is not exposed outside one. `localhost`
 * counts as secure.
 *
 * Port 4177, so this and the other three demos can be open side by side.
 */
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  esbuild: { tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } },
  server: { port: 4177 },
  preview: { port: 4177 },
})
