import type { FingerlyVueOptions } from '@fingerly/vue'

import type { FingerlyPublicConfig } from '../options.js'

/**
 * Turn the published runtime config into the options `createFingerly()` takes.
 *
 * Its own function because of the missing-key case, which is the one thing
 * here worth a decision. Unlike a build-time key, this one can legitimately be
 * absent when the module runs and present when the app starts - that is what
 * `NUXT_PUBLIC_FINGERLY_API_KEY` is for - so the module cannot fail the build
 * over it, and this is the last place that can say anything at all.
 *
 * It warns and carries on rather than throwing. Throwing here would take down
 * the whole app over a fraud signal, and installing nothing would be worse
 * than that: every `useIdentify()` in the app would then fail with "no plugin
 * found", pointing at wiring that is in fact correct. Installed with an empty
 * key, the app renders, the composables work, and `identify()` is the thing
 * that fails - with the SDK's own message about a missing key, at the moment
 * somebody is looking for it.
 */
export function toVueOptions(config: Partial<FingerlyPublicConfig> | undefined): FingerlyVueOptions {
  const apiKey = config?.apiKey ?? ''

  if (!apiKey) {
    console.warn(
      '[fingerly] No SDK key. Set NUXT_PUBLIC_FINGERLY_API_KEY in the environment, ' +
        'or fingerly.apiKey in nuxt.config.ts. Identification will fail until one is set.',
    )
  }

  return {
    apiKey,
    ...(config?.apiVersion === undefined || config.apiVersion === '' ? {} : { apiVersion: config.apiVersion }),
    ...(config?.endpoint === undefined || config.endpoint === ''
      ? {}
      : { endpoint: config.endpoint }),
    ...(config?.endpoints === undefined || config.endpoints.length === 0
      ? {}
      : { endpoints: config.endpoints }),
    ...(config?.fallbackToDefaultEndpoint === undefined
      ? {}
      : { fallbackToDefaultEndpoint: config.fallbackToDefaultEndpoint }),
    ...(config?.submit === undefined ? {} : { submit: config.submit }),
    ...(config?.consent === undefined || (config.consent as string) === '' ? {} : { consent: config.consent }),
  }
}
