/**
 * @badele/nuxt - the Badele SDK as a Nuxt module.
 *
 * Thin on purpose. `@badele/vue` already holds the client, the shared
 * identification and the composables; re-implementing any of that here would
 * mean two copies of the rule that N components asking is one submission.
 * What Nuxt changes is three things, and they are what this module does:
 *
 *   - configuration comes from `nuxt.config.ts` and, at runtime, from the
 *     environment (`NUXT_PUBLIC_BADELE_*`);
 *   - the Vue plugin is installed by a Nuxt plugin rather than by the app;
 *   - the composables are auto-imported, so a page uses them without an
 *     import line, which is what every other Nuxt composable does.
 */

import { addImports, addPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'

import { resolvePublicConfig, type BadelePublicConfig, type ModuleOptions } from './options.js'

export type { BadelePublicConfig, ModuleOptions } from './options.js'

/** The composables the module auto-imports, from `@badele/vue` unchanged. */
const COMPOSABLES = ['useBadele', 'useIdentify', 'useVerdict'] as const

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@badele/nuxt',
    configKey: 'badele',
    compatibility: { nuxt: '>=3.0.0' },
  },
  defaults: {},
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    const runtimeConfig = nuxt.options.runtimeConfig
    runtimeConfig.public ??= {} as typeof runtimeConfig.public

    // Published rather than closed over, so the deployment environment can
    // still override it - a module that baked the key into the bundle would
    // need a rebuild per environment.
    runtimeConfig.public.badele = resolvePublicConfig(
      options,
      runtimeConfig.public.badele as Partial<BadelePublicConfig> | undefined,
    )

    // Universal, not `.client`. Installing the Vue plugin collects nothing -
    // it makes the client reachable and no more - and registering it on the
    // server too is what lets a page call `useIdentify()` during setup and
    // render, with the collection itself deferred to `onMounted`. A
    // client-only plugin would make the composable throw on the server render
    // that Nuxt does first.
    addPlugin(resolver.resolve('./runtime/plugin'))

    for (const name of COMPOSABLES) {
      addImports({ name, from: '@badele/vue' })
    }
  },
})

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    badele: BadelePublicConfig
  }
}
