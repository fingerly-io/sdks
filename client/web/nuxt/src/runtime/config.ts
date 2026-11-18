import type { FingerlyVueOptions } from '@fingerly/vue'

import type { FingerlyPublicConfig } from '../options.js'

let warnedMissingKey = false

export function toVueOptions(config: Partial<FingerlyPublicConfig> | undefined): FingerlyVueOptions {
  const apiKey = config?.apiKey ?? ''

  if (!apiKey && !warnedMissingKey) {
    warnedMissingKey = true
    console.warn(
      '[fingerly] No SDK key. Set NUXT_PUBLIC_FINGERLY_API_KEY in the environment, ' +
        'or fingerly.apiKey in nuxt.config.ts. Identification will fail until one is set.',
    )
  }

  return {
    apiKey,
    ...(config?.apiVersion === undefined || config.apiVersion === ''
      ? {}
      : { apiVersion: config.apiVersion }),
    ...(config?.endpoints === undefined || config.endpoints.length === 0
      ? {}
      : { endpoints: config.endpoints }),
    ...(config?.fallbackToDefaultEndpoint === undefined
      ? {}
      : { fallbackToDefaultEndpoint: config.fallbackToDefaultEndpoint }),
    ...(config?.incognitoDetection === undefined || (config.incognitoDetection as string) === ''
      ? {}
      : { incognitoDetection: config.incognitoDetection }),
    ...(config?.continuity === undefined || (config.continuity as string) === ''
      ? {}
      : { continuity: config.continuity }),
    // No `consent`: the client starts `pending` whatever the runtime config
    // holds, and only a runtime `setConsent()` after a visitor answer moves it.
  }
}
