/**
 * @fingerly/web-js - the browser SDK.
 *
 * Wires the browser source set and the tamper layer into `@fingerly/core`'s
 * client. Everything platform-specific is in this package; everything about
 * scheduling, transport and scoring is in the kernel, which is what lets the
 * same detectors run again on the server over a stored report.
 *
 * ```ts
 * import { load } from '@fingerly/web-js'
 *
 * const fingerly = await load({ apiKey: 'fly_pk_production_…' })
 * const { visitorId, visitorIsNew, suspectScore, verdicts } = await fingerly.identify()
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

import { FingerlyClient, type FingerlyClientOptions } from '@fingerly/core'

import { inspectIntegrity } from './lies/index.js'
import { browserSources } from './sources/index.js'

export interface FingerlyOptions
  extends Omit<FingerlyClientOptions, 'sources' | 'integrity' | 'platform'> {
  /**
   * Replace the source set. Intended for tests and for a caller who has a
   * reason to run a subset; the default is every browser source.
   */
  sources?: FingerlyClientOptions['sources']
}

/**
 * Build a client with the browser sources installed.
 *
 * Async, and returns a promise, even though there is currently nothing to
 * await. That is deliberate: the shape callers write today is the shape that
 * still works when this needs to warm a worker or wait for a document to be
 * ready, and changing `load()` from sync to async later would break every
 * integration at once.
 *
 * Loading collects nothing and sends nothing, whatever `consent` is: no
 * source runs until `identify()` or `collect()` is called, and those refuse
 * while consent is not `granted`. So a page that needs consent first can load
 * early with `consent: 'pending'` and call `setConsent('granted')` from its
 * consent tool.
 */
export function load(options: FingerlyOptions): Promise<FingerlyClient> {
  return Promise.resolve(
    new FingerlyClient({
      ...options,
      platform: 'web',
      sources: options.sources ?? browserSources,
      integrity: (report) => inspectIntegrity(report.sources),
    }),
  )
}

export { browserSources } from './sources/index.js'
export { inspectIntegrity } from './lies/index.js'

// Re-exported so a page that only installs @fingerly/web-js can name the types it
// receives without also depending on the kernel directly.
export type {
  FingerlyEvent,
  FingerlyWebEvent,
  Confidence,
  ConsentState,
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
} from '@fingerly/core'
export { ConsentError, FingerlyClient, SOURCE, TransportError } from '@fingerly/core'
