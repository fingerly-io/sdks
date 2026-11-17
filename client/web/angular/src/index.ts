/**
 * @fingerly/angular - Angular bindings for the Fingerly SDK (`0.4.0`, single-pass `v: 3`).
 */

export { FINGERLY, FINGERLY_OPTIONS, provideFingerly } from './provide.js'

export { createFingerly, FingerlyServerError } from './state.js'
export type { Fingerly, FingerlyOptions, IdentifyAnswer } from './state.js'

export { injectFingerly, injectIdentify } from './inject.js'
export type { InjectIdentifyOptions } from './inject.js'

export type {
  CollectOptions,
  Confidence,
  ConsentState,
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
