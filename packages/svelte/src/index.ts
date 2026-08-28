/**
 * @badele/svelte - Svelte 5 bindings for the Badele SDK.
 *
 * One state per app, held in Svelte's context, read as plain reactive
 * properties. See the README for the whole surface with examples.
 *
 * Requires Svelte 5: the state is built with runes, which is what lets a
 * component read `badele.verdicts` and re-render, with no store and no `$`
 * prefix at the call site.
 */

export { BADELE_KEY, setupBadele, useBadele } from './context.js'

export { createBadele, BadeleServerError } from './state.svelte.js'
export type { Badele, BadeleOptions } from './state.svelte.js'

export { useIdentify, useVerdict } from './hooks.svelte.js'
export type { UseIdentifyOptions, UseVerdictReturn, VerdictName } from './hooks.svelte.js'

// Re-exported so a component can name what it receives without also declaring
// a dependency on the browser SDK.
export type {
  BadeleWebEvent,
  Confidence,
  IdentifyResult,
  IntegrityReport,
  Lie,
  SignalOutcome,
  SignalReport,
  SignalStatus,
  Verdict,
  Verdicts,
} from '@badele/web-js'
export { TransportError } from '@badele/web-js'
