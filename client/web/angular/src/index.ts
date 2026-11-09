/**
 * @fingerly/angular - Angular bindings for the Fingerly SDK.
 *
 * `provideFingerly()` in the application's providers, then `injectIdentify()`
 * wherever a component needs an answer. One identification per application
 * injector, exposed as signals.
 *
 * No decorators anywhere, which is what lets the package build with `tsc` and
 * be consumed without an Angular compilation step: the state is an injection
 * token with a factory rather than an `@Injectable` class.
 */

export { FINGERLY, FINGERLY_OPTIONS, provideFingerly } from './provide.js'

export { FingerlyServerError, createFingerly } from './state.js'
export type { Fingerly, FingerlyOptions } from './state.js'

export { injectFingerly, injectIdentify } from './inject.js'
export type { InjectIdentifyOptions } from './inject.js'

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
} from '@fingerly/web-js'
export { ConsentError, TransportError } from '@fingerly/web-js'
