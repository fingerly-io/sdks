import { defineConfig } from 'tsup'

/**
 * The demo bundle.
 *
 * Its own config rather than a second entry in `tsup.config.ts`, because the
 * two builds want opposite things from the same dependency. The package build
 * externalises React - bundling it would hand an app two copies and two sets
 * of hook internals - while `demo/index.html` is one `<script>` tag with no
 * module resolution behind it, so this build has to inline React, the binding
 * and the SDK together.
 *
 * It is a separate command rather than part of `build` for the same reason:
 * nothing published depends on it, and a demo artefact has no business being
 * rebuilt on the way to `dist/`.
 */
export default defineConfig({
  entry: { bundle: 'demo/main.tsx' },
  format: ['iife'],
  outDir: 'demo',
  outExtension: () => ({ js: '.js' }),
  platform: 'browser',
  target: 'es2020',
  noExternal: ['react', 'react-dom', '@fingerly/web-js', '@fingerly/core'],
  // React reads this to pick its development or production build. Left
  // undefined, the bundled copy throws on the first render.
  define: { 'process.env.NODE_ENV': '"development"' },
})
