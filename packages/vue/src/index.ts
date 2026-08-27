/**
 * @badele/vue - Vue 3 bindings for the Badele SDK.
 *
 * A plugin that holds one client and one shared result, and composables that
 * read it. See the README for the whole surface with examples.
 */

export { badeleKey, BadeleServerError, createBadele } from './plugin.js'
export type {
  BadeleContext,
  BadeleState,
  BadeleVueOptions,
  ReadonlyState,
} from './plugin.js'

export { useBadele } from './useBadele.js'
export { useIdentify } from './useIdentify.js'
export type { UseIdentifyOptions, UseIdentifyReturn } from './useIdentify.js'
export { useVerdict } from './useVerdict.js'
export type { UseVerdictReturn, VerdictName } from './useVerdict.js'

// Re-exported so a component can name what it receives without also declaring a
// dependency on the browser SDK.
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
