/**
 * @fingerly/web-js - the browser SDK.
 *
 * Wires the browser source set and the tamper layer into `@fingerly/core`'s
 * client. Everything platform-specific is in this package; scheduling and
 * transport are in the kernel, and scoring is on the server, where customers
 * set the weights and a page cannot read or edit them.
 *
 * ```ts
 * import { load } from '@fingerly/web-js'
 *
 * const fingerly = await load({ apiKey: 'fly_pk_production_…' })
 * const { visitorId, visitorIsNew, suspectLevel } = await fingerly.identify()
 *
 * // The server's answer, in the same round trip. Everything about the score
 * // lives on the server, under the weights you set. `suspectLevel` is null
 * // when absent, which is not a clean result. Signals are read on your backend.
 * if (suspectLevel === 'high') {
 *   // step up to a challenge
 * }
 * ```
 *
 * Nothing about that decision happens in the page. This package collects and
 * submits; the server scores.
 */

import { FingerlyClient, type FingerlyClientOptions } from '@fingerly/core'

import { detectEmbedding } from './embedding.js'
import { inspectIntegrity } from './lies/index.js'
import { browserSources } from './sources/index.js'

export interface FingerlyOptions
  extends Omit<FingerlyClientOptions, 'sources' | 'integrity' | 'platform' | 'embedding'> {
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
 * while consent is not `granted`. Consent defaults to `pending`, so a page can
 * load early and call `setConsent('granted')` from its consent tool, or pass
 * `consent: 'granted'` once it already has consent (or know none is required here; see docs/privacy.md §4).
 */
export function load(options: FingerlyOptions): Promise<FingerlyClient> {
  // A configuration mistake, such as a missing key, rejects rather than
  // throwing. Every binding chains `load().then(...)`, and a synchronous throw
  // skips their `.catch`: it unmounted a whole React root and failed a Nuxt
  // app's start over a fraud signal.
  return new Promise((resolve) =>
    resolve(
      new FingerlyClient({
        ...options,
        platform: 'web',
        sources: options.sources ?? browserSources,
        integrity: (report) => inspectIntegrity(report.sources),
        // After the caller's options, so nothing passed to load() can turn
        // detection off: there is no supported way to fingerprint in an app.
        embedding: () => detectEmbedding(),
      }),
    ),
  )
}

export { browserSources } from './sources/index.js'
export { detectEmbedding } from './embedding.js'
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
  IntegrityReport,
  Lie,
  SignalOutcome,
  SignalReport,
  SignalStatus,
} from '@fingerly/core'
export { ConsentError, FingerlyClient, SOURCE, TransportError } from '@fingerly/core'

// For the framework bindings, so each reads the server's level the same way.
export { isSuspiciousLevel } from '@fingerly/core'
