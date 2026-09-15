/**
 * @fingerly/vue - Vue 3 bindings for the Fingerly SDK.
 *
 * A plugin that holds one client and one shared result, and composables that
 * read it. See the README for the whole surface with examples.
 */

export { fingerlyKey, FingerlyServerError, createFingerly } from './plugin.js'
export type {
  FingerlyContext,
  FingerlyState,
  FingerlyVueOptions,
  ReadonlyState,
} from './plugin.js'

export { useFingerly } from './useFingerly.js'
export { useIdentify } from './useIdentify.js'
export type { UseIdentifyOptions, UseIdentifyReturn } from './useIdentify.js'
export { useVerdict } from './useVerdict.js'
export type { UseVerdictReturn, VerdictName } from './useVerdict.js'

// Re-exported so a component can name what it receives without also declaring a
// dependency on the browser SDK.
export type {
  FingerlyWebEvent,
  Confidence,
  IdentifyResult,
  IntegrityReport,
  Lie,
  SignalOutcome,
  SignalReport,
  SignalStatus,
  Verdict,
  Verdicts,
} from '@fingerly/web-js'
export { TransportError } from '@fingerly/web-js'
