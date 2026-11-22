/**
 * What the module is configured with, and what ends up in `runtimeConfig.public.fingerly`.
 */

import type { AgentDetection, ConsentState, Continuity, IncognitoDetection } from '@fingerly/vue'

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
  /**
   * Whether an identified private window is carried across the reports of
   * one tab: `'none'` (the default) keeps nothing in the browser, `'session'`
   * keeps one signed value in `sessionStorage` for the life of the tab.
   */
  continuity?: Continuity
  /**
   * Observe how the page is operated, for recognising an assistant that
   * drives the visitor's own browser. Off by default; `'interaction'` turns it
   * on. Counts input events only once consent is `granted`.
   */
  agentDetection?: AgentDetection
  /**
   * Not a setting. Consent is the visitor's answer, so it is never read from
   * `nuxt.config.ts` or the environment: the client always starts `pending`
   * and only a runtime `setConsent()` call, made after the visitor answered,
   * changes it. Kept in the type so a value here is reported at build time
   * instead of being silently ignored.
   */
  consent?: ConsentState
}

/**
 * The shape published at `runtimeConfig.public.fingerly`.
 *
 * Every key is present so Nuxt allows `NUXT_PUBLIC_FINGERLY_*` environment
 * overrides at server startup. Consent is deliberately not one of them: a
 * deployment-wide value would apply to every visitor before any of them
 * answered.
 */
export interface FingerlyPublicConfig {
  apiKey: string
  apiVersion: string
  endpoints: string[]
  fallbackToDefaultEndpoint: boolean
  incognitoDetection: IncognitoDetection
  continuity: Continuity
  /** `''` (the default) leaves agent detection off. */
  agentDetection: AgentDetection | ''
}

/** The build-time warning for a `consent` value in the module options. */
export const STATIC_CONSENT_WARNING =
  "[fingerly] fingerly.consent in nuxt.config.ts is ignored. Consent is each visitor's answer: " +
  'the client starts pending, and you call setConsent() at runtime once the visitor has answered.'

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
    continuity: pick(existing?.continuity, options.continuity) ?? 'none',
    agentDetection: pick(existing?.agentDetection, options.agentDetection) ?? '',
  }
}
