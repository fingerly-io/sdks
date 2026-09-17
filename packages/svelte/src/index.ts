/**
 * @fingerly/svelte - Svelte 5 bindings for the Fingerly SDK.
 *
 * One state per app, held in Svelte's context, read as plain reactive
 * properties. See the README for the whole surface with examples.
 *
 * Requires Svelte 5: the state is built with runes, which is what lets a
 * component read `fingerly.verdicts` and re-render, with no store and no `$`
 * prefix at the call site.
 */

export { FINGERLY_KEY, setupFingerly, useFingerly } from './context.js'

export { createFingerly, FingerlyServerError } from './state.svelte.js'
export type { Fingerly, FingerlyOptions } from './state.svelte.js'

export { useIdentify, useVerdict } from './hooks.svelte.js'
export type { UseIdentifyOptions, UseVerdictReturn, VerdictName } from './hooks.svelte.js'

// Re-exported so a component can name what it receives without also declaring
// a dependency on the browser SDK.
export type {
  FingerlyWebEvent,
  Confidence,
  ConsentState,
  IdentifyResult,
  IntegrityReport,
  Lie,
  SignalOutcome,
  SignalReport,
  SignalStatus,
  Verdict,
  Verdicts,
} from '@fingerly/web-js'
export { ConsentError, TransportError } from '@fingerly/web-js'
