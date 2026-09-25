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
    // The script-tag build. Bundles @fingerly/core rather than externalising it,
    // because a page dropping in one <script> has no module resolution to do
    // the linking - which is the entire reason this build exists.
    //
    // Named for nothing in particular. Filter lists match script file names,
    // and one carrying ours would be blocked wherever a customer hosts it.
    entry: { browser: 'src/global.ts' },
    format: ['iife'],
    globalName: 'Fingerly',
    outExtension: () => ({ js: '.global.js' }),
    platform: 'browser',
    target: 'es2020',
    noExternal: ['@fingerly/core'],
    minify: true,
  },
])
