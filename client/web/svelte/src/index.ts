/**
 * @fingerly/svelte - Svelte 5 bindings for the Fingerly SDK (`0.5.0`, single-pass `v: 3`).
 */

export { FINGERLY_KEY, setupFingerly, useFingerly } from './context.js'

export { createFingerly, FingerlyServerError } from './state.svelte.js'
export type { Fingerly, FingerlyOptions, IdentifyAnswer } from './state.svelte.js'

export { useIdentify } from './hooks.svelte.js'
export type { UseIdentifyOptions } from './hooks.svelte.js'

export type {
  CollectOptions,
  Confidence,
  ConsentState,
  Continuity,
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
