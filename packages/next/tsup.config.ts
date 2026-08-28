import { defineConfig } from 'tsup'

export default defineConfig({
  // Two entries, because the package has two halves that must not merge: the
  // client one carries a "use client" directive and the server one is imported
  // by Server Actions, where a client module is a reference rather than a
  // function.
  entry: ['src/index.ts', 'src/server.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // No `treeshake`, for the same reason as @badele/react: it runs the output
  // back through rollup, which merges modules and drops every module-level
  // directive - "use client" included.
  target: 'es2020',
  // Peers, and @badele/react is a dependency the app resolves for itself: two
  // copies of it would be two providers and two shared identifications.
  external: ['react', '@badele/react'],
})
