import { defineConfig } from 'tsup'

export default defineConfig({
  // Two entries with the directory structure preserved: Nuxt loads the module
  // itself during the build and resolves the plugin by path, at
  // `./runtime/plugin` relative to the module - so that file has to exist at
  // that path in `dist` rather than be bundled into the module.
  entry: ['src/module.ts', 'src/runtime/plugin.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2020',
  // `#app` is Nuxt's virtual module, resolvable only inside a Nuxt build. The
  // rest are the app's own copies - a second copy of @badele/vue would be a
  // second shared identification, which is the one thing this must not do.
  external: ['#app', '@nuxt/kit', '@nuxt/schema', 'nuxt', 'vue', '@badele/vue'],
})
