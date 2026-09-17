/**
 * A stand-in for `#app`, Nuxt's virtual module.
 *
 * `#app` exists only inside a Nuxt build, so a test that wanted the real one
 * would have to boot Nuxt. This is the alternative: two functions with the
 * signatures the plugin uses, wired into both `vitest.config.ts` and
 * `tsconfig.json`, so the file under test is the plugin that ships rather than
 * a copy of its body written into a test.
 */

import type { App } from 'vue'

export interface NuxtAppLike {
  vueApp: App
}

let runtimeConfig: { public: Record<string, unknown> } = { public: {} }

/** What `useRuntimeConfig()` will return, set by the test. */
export function __setRuntimeConfig(config: Record<string, unknown>): void {
  runtimeConfig = { public: config }
}

export function useRuntimeConfig(): { public: Record<string, any> } {
  return runtimeConfig
}

/**
 * The real one attaches metadata and registers ordering hints. The plugin
 * under test uses neither, so this hands the function straight back.
 */
export function defineNuxtPlugin<T extends (nuxtApp: NuxtAppLike) => unknown>(plugin: T): T {
  return plugin
}
