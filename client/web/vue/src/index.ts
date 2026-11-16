/**
 * @fingerly/vue - Vue 3 bindings for the Fingerly SDK (`0.3.0`, single-pass `v: 3`).
 */

export { createFingerly, fingerlyKey, FingerlyServerError } from './plugin.js'
export type {
  FingerlyContext,
  FingerlyState,
  FingerlyVueOptions,
  ReadonlyState,
} from './plugin.js'

export { useFingerly } from './useFingerly.js'
export { useIdentify } from './useIdentify.js'
export type { UseIdentifyOptions, UseIdentifyReturn } from './useIdentify.js'

export type {
  CollectOptions,
  Confidence,
  ConsentState,
  FingerlyWebEvent,
  IdentifyOptions,
  IdentifyResult,
  IncognitoDetection,
  IntegrityReport,
  Lie,
  SignalOutcome,
  SignalReport,
  SignalStatus,
  SuspectLevel,
} from '@fingerly/web-js'
export { ConsentError, TransportError } from '@fingerly/web-js'
