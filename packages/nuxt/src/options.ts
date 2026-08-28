/**
 * What the module is configured with, and what ends up in the runtime config.
 *
 * A separate module from `module.ts` because this half is a pure function of
 * two objects, runs in the browser as well as in the build, and is the part
 * with a decision in it - see [[resolvePublicConfig]] on why what wins.
 */

/** The `badele` block in `nuxt.config.ts`. */
export interface ModuleOptions {
  /** The SDK key from the dashboard. A public key is safe in a page. */
  apiKey?: string
  /** Origin of the API. Defaults to production. */
  endpoint?: string
  /**
   * Collect and score without submitting anything.
   *
   * For an app that wants the local verdicts and nothing else. `requestId`
   * stays null, which is the honest answer: nothing was sent, so there is
   * nothing to fetch later.
   */
  submit?: boolean
}

/**
 * The shape published at `runtimeConfig.public.badele`.
 *
 * Every key is present even when nothing set it, and that is not tidiness.
 * Nuxt only lets the environment override keys that already exist in the
 * runtime config, so a `submit` omitted here is a `NUXT_PUBLIC_BADELE_SUBMIT`
 * that silently does nothing. The empty string is the "not set" value, which
 * the plugin reads as "use the default".
 */
export interface BadelePublicConfig {
  apiKey: string
  endpoint: string
  submit: boolean
}

/**
 * Merge the module's options with whatever is already in the runtime config.
 *
 * The runtime config wins, and that is the whole point of the function. Nuxt
 * reads `runtimeConfig.public` when the server *starts*, so
 * `NUXT_PUBLIC_BADELE_API_KEY` in the deployment environment overrides the
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
  existing: Partial<BadelePublicConfig> | undefined,
): BadelePublicConfig {
  const pick = <T>(fromConfig: T | undefined, fromOptions: T | undefined): T | undefined =>
    fromConfig !== undefined && fromConfig !== '' ? fromConfig : fromOptions

  return {
    apiKey: pick(existing?.apiKey, options.apiKey) ?? '',
    endpoint: pick(existing?.endpoint, options.endpoint) ?? '',
    submit: existing?.submit ?? options.submit ?? true,
  }
}
