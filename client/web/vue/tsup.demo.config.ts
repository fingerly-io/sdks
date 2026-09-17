import { defineConfig } from 'tsup'

/**
 * The demo bundle.
 *
 * Its own config rather than a second entry in `tsup.config.ts`, because the
 * two builds want opposite things from the same dependency. The package build
 * externalises Vue - bundling it would hand an app two copies and two
 * reactivity systems - while `demo/index.html` is one `<script>` tag with no
 * module resolution behind it, so this build has to inline Vue, the binding
 * and the SDK together.
 *
 * It is a separate command rather than part of `build` for the same reason:
 * nothing published depends on it, and a demo artefact has no business being
 * rebuilt on the way to `dist/`.
 */
export default defineConfig({
  entry: { bundle: 'demo/main.ts' },
  format: ['iife'],
  outDir: 'demo',
  outExtension: () => ({ js: '.js' }),
  platform: 'browser',
  target: 'es2020',
  noExternal: ['vue', '@fingerly/web-js', '@fingerly/core'],
  // Vue's bundler build reads these at compile time. Left undefined they are a
  // ReferenceError thrown before the app mounts, which looks like a broken
  // binding rather than a missing build flag.
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
})
