import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  // No `platform: 'browser'`. This package must run unchanged in a page, in
  // Node and in a React Native bundle, which is the whole reason the collectors
  // live in @fingerly/web-js instead of here.
  target: 'es2020',
})
