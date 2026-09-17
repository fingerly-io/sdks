import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // No `treeshake`, unlike the other packages here, and the reason is the
  // directive below. Tree shaking runs the esbuild output back through rollup,
  // which merges the modules and drops every module-level directive on the way
  // - "use client" included, with a warning that reads like a lint rule rather
  // than the breakage it is. The entry is five kilobytes of hooks with no dead
  // branches to remove; the directive is worth more than the shaking.
  target: 'es2020',
  // React is a peer dependency: bundling it would give the app two copies,
  // two sets of hook internals, and a context that silently never matches.
  external: ['react'],
})
