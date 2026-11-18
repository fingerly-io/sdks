'use client'

/**
 * @fingerly/react - React bindings for the Fingerly SDK (`0.5.2`, single-pass `v: 3`).
 */

export { FingerlyContext, FingerlyProvider } from './context.js'
export type { FingerlyProviderProps } from './context.js'

export { createFingerlyStore, FingerlyServerError } from './store.js'
export type { FingerlyReactOptions, FingerlyState, FingerlyStore, IdentifyAnswer } from './store.js'

export { useFingerly } from './useFingerly.js'
export { useIdentify } from './useIdentify.js'
export type { UseIdentifyOptions, UseIdentifyReturn } from './useIdentify.js'

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
