/**
 * What the module is configured with, and what ends up in `runtimeConfig.public.fingerly`.
 */

import type { ConsentState, IncognitoDetection } from '@fingerly/vue'

/** The `fingerly` block in `nuxt.config.ts`. */
export interface ModuleOptions {
  /** The SDK key from the dashboard. A public key is safe in a page. */
  apiKey?: string
  /** API route version. Defaults to v1. */
  apiVersion?: string
  /** Ordered first-party ingestion endpoints, such as `['/k7x2qm4a']`. */
  endpoints?: string[]
  fallbackToDefaultEndpoint?: boolean
  /**
   * Controls whether opt-in extended incognito probes (`storage_durability`)
   * execute (`'standard'` default or `'extended'`).
   */
  incognitoDetection?: IncognitoDetection
  /** The consent the app starts with. Defaults to `pending`. */
  consent?: ConsentState
}

/**
 * The shape published at `runtimeConfig.public.fingerly`.
 *
 * Every key is present so Nuxt allows `NUXT_PUBLIC_FINGERLY_*` environment
 * overrides at server startup.
 */
export interface FingerlyPublicConfig {
  apiKey: string
  apiVersion: string
  endpoints: string[]
  fallbackToDefaultEndpoint: boolean
  incognitoDetection: IncognitoDetection
  consent: ConsentState
}

export function resolvePublicConfig(
  options: ModuleOptions,
  existing: Partial<FingerlyPublicConfig> | undefined,
): FingerlyPublicConfig {
  const pick = <T>(fromConfig: T | undefined, fromOptions: T | undefined): T | undefined =>
    fromConfig !== undefined && fromConfig !== '' ? fromConfig : fromOptions

  return {
    apiKey: pick(existing?.apiKey, options.apiKey) ?? '',
    apiVersion: pick(existing?.apiVersion, options.apiVersion) ?? 'v1',
    endpoints: existing?.endpoints ?? options.endpoints ?? [],
    fallbackToDefaultEndpoint:
      existing?.fallbackToDefaultEndpoint ?? options.fallbackToDefaultEndpoint ?? false,
    incognitoDetection:
      pick(existing?.incognitoDetection, options.incognitoDetection) ?? 'standard',
    consent: pick(existing?.consent, options.consent) ?? 'pending',
  }
}
