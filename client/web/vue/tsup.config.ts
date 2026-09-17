import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  // Vue is a peer dependency: bundling it would give the app two copies, two
  // reactivity systems, and injections that silently never resolve.
  external: ['vue'],
})
