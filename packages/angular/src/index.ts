/**
 * @badele/angular - Angular bindings for the Badele SDK.
 *
 * `provideBadele()` in the application's providers, then `injectIdentify()` or
 * `injectVerdict()` wherever a component needs an answer. One identification
 * per application injector, exposed as signals.
 *
 * No decorators anywhere, which is what lets the package build with `tsc` and
 * be consumed without an Angular compilation step: the state is an injection
 * token with a factory rather than an `@Injectable` class.
 */

export { BADELE, BADELE_OPTIONS, provideBadele } from './provide.js'

export { BadeleServerError, createBadele } from './state.js'
export type { Badele, BadeleOptions } from './state.js'

export { injectBadele, injectIdentify, injectVerdict } from './inject.js'
export type { InjectIdentifyOptions, InjectVerdictResult, VerdictName } from './inject.js'

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
