/**
 * @badele/web-js - the browser SDK.
 *
 * Wires the browser source set and the tamper layer into `@badele/core`'s
 * client. Everything platform-specific is in this package; everything about
 * scheduling, transport and scoring is in the kernel, which is what lets the
 * same detectors run again on the server over a stored report.
 *
 * ```ts
 * import { load } from '@badele/web-js'
 *
 * const badele = await load({ apiKey: 'pk_live_...' })
 * const { visitorId, visitorIsNew, suspectScore, verdicts } = await badele.identify()
 *
 * // The server's answer, in the same round trip.
 * if (suspectScore !== null && suspectScore >= 30) {
 *   // step up to a challenge
 * }
 *
 * // The local verdicts are still there, and are still advisory: they are
 * // computed in the page, by code the visitor controls.
 * if (verdicts.automation.value && verdicts.automation.confidence === 'high') {
 *   // ...
 * }
 * ```
 */

import { BadeleClient, type BadeleClientOptions } from '@badele/core'

import { inspectIntegrity } from './lies/index.js'
import { browserSources } from './sources/index.js'

export interface BadeleOptions
  extends Omit<BadeleClientOptions, 'sources' | 'integrity' | 'platform'> {
  /**
   * Replace the source set. Intended for tests and for a caller who has a
   * reason to run a subset; the default is every browser source.
   */
  sources?: BadeleClientOptions['sources']
}

/**
 * Build a client with the browser sources installed.
 *
 * Async, and returns a promise, even though there is currently nothing to
 * await. That is deliberate: the shape callers write today is the shape that
 * still works when this needs to warm a worker or wait for a document to be
 * ready, and changing `load()` from sync to async later would break every
 * integration at once.
 */
export function load(options: BadeleOptions): Promise<BadeleClient> {
  return Promise.resolve(
    new BadeleClient({
      ...options,
      platform: 'web',
      sources: options.sources ?? browserSources,
      integrity: (report) => inspectIntegrity(report.sources),
    }),
  )
}

export { browserSources } from './sources/index.js'
export { inspectIntegrity } from './lies/index.js'

// Re-exported so a page that only installs @badele/web-js can name the types it
// receives without also depending on the kernel directly.
export type {
  BadeleEvent,
  BadeleWebEvent,
  Confidence,
  IdentifyOptions,
  IdentifyResult,
  IdentifyTrigger,
  IntegrityReport,
  Lie,
  SignalOutcome,
  SignalReport,
  SignalStatus,
  Verdict,
  Verdicts,
} from '@badele/core'
export { BadeleClient, SOURCE, TransportError } from '@badele/core'
