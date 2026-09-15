/**
 * @fingerly/angular - Angular bindings for the Fingerly SDK.
 *
 * `provideFingerly()` in the application's providers, then `injectIdentify()` or
 * `injectVerdict()` wherever a component needs an answer. One identification
 * per application injector, exposed as signals.
 *
 * No decorators anywhere, which is what lets the package build with `tsc` and
 * be consumed without an Angular compilation step: the state is an injection
 * token with a factory rather than an `@Injectable` class.
 */

export { FINGERLY, FINGERLY_OPTIONS, provideFingerly } from './provide.js'

export { FingerlyServerError, createFingerly } from './state.js'
export type { Fingerly, FingerlyOptions } from './state.js'

export { injectFingerly, injectIdentify, injectVerdict } from './inject.js'
export type { InjectIdentifyOptions, InjectVerdictResult, VerdictName } from './inject.js'

// Re-exported so a component can name what it receives without also declaring
// a dependency on the browser SDK.
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
