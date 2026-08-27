import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    treeshake: true,
    platform: 'browser',
    target: 'es2020',
  },
  {
    // The script-tag build. Bundles @badele/core rather than externalising it,
    // because a page dropping in one <script> has no module resolution to do
    // the linking - which is the entire reason this build exists.
    entry: { badele: 'src/global.ts' },
    format: ['iife'],
    globalName: 'Badele',
    outExtension: () => ({ js: '.global.js' }),
    platform: 'browser',
    target: 'es2020',
    noExternal: ['@badele/core'],
    minify: true,
  },
])
