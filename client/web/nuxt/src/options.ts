/**
 * What the module is configured with, and what ends up in the runtime config.
 *
 * A separate module from `module.ts` because this half is a pure function of
 * two objects, runs in the browser as well as in the build, and is the part
 * with a decision in it - see [[resolvePublicConfig]] on why what wins.
 */

import type { ConsentState } from '@fingerly/vue'

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
   * Collect without submitting anything.
   *
   * Everything the server decides comes back empty: no `requestId`, no
   * `visitorId`, no `suspectScore`, no `suspectLevel`. That is the honest
   * answer rather than a gap - nothing was sent, so nobody scored it, and
   * this SDK decides nothing on its own.
   */
  submit?: boolean
  /**
   * The consent the app starts with. Defaults to `pending`.
   *
   * Leave it `pending` while identification waits on a consent banner, then
   * call `useFingerly().setConsent('granted')` from wherever the banner is
   * answered, or set `granted` once you have consent (or another lawful
   * basis). Until then `useIdentify({ immediate: true })` waits and nothing
   * is collected or sent.
   */
  consent?: ConsentState
}

/**
 * The shape published at `runtimeConfig.public.fingerly`.
 *
 * Every key is present even when nothing set it, and that is not tidiness.
 * Nuxt only lets the environment override keys that already exist in the
 * runtime config, so a `submit` omitted here is a `NUXT_PUBLIC_FINGERLY_SUBMIT`
 * that silently does nothing. The empty string is the "not set" value, which
 * the plugin reads as "use the default".
 */
export interface FingerlyPublicConfig {
  apiKey: string
  apiVersion: string
  endpoints: string[]
  fallbackToDefaultEndpoint: boolean
  submit: boolean
  consent: ConsentState
}

/**
 * Merge the module's options with whatever is already in the runtime config.
 *
 * The runtime config wins, and that is the whole point of the function. Nuxt
 * reads `runtimeConfig.public` when the server *starts*, so
 * `NUXT_PUBLIC_FINGERLY_API_KEY` in the deployment environment overrides the
 * built bundle - one build promoted through staging and production, keyed
 * differently in each, with no rebuild. A module that let its build-time
 * option win would quietly take that away.
 *
 * The empty key is a legitimate build-time state for the same reason: the
 * environment supplies it later. That is why nothing here throws, and why the
 * plugin says something at runtime instead.
 */
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
    fallbackToDefaultEndpoint: existing?.fallbackToDefaultEndpoint ?? options.fallbackToDefaultEndpoint ?? false,
    submit: existing?.submit ?? options.submit ?? true,
    consent: pick(existing?.consent, options.consent) ?? 'pending',
  }
}
