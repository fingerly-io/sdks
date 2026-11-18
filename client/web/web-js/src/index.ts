/**
 * @fingerly/web-js - the browser SDK (`v: 3`, single-pass).
 *
 * Wires the browser source set and the tamper layer into `@fingerly/core`'s
 * single-pass v3 client. Everything platform-specific is in this package;
 * scheduling and transport are in the kernel, and scoring is on the server.
 */

import { FingerlyClient, type FingerlyClientOptions } from '@fingerly/core'

import { detectEmbedding } from './embedding.js'
import { inspectIntegrity } from './lies/index.js'
import { browserSources } from './sources/index.js'
import { startDurabilityProbe } from './sources/durability.js'
import { warmSlowSources } from './warm.js'

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
 */
export function load(options: FingerlyOptions): Promise<FingerlyClient> {
  return new Promise((resolve) => {
    const client = new FingerlyClient({
      ...options,
      platform: 'web',
      sources: options.sources ?? browserSources,
      integrity: (report) => inspectIntegrity(report.sources),
      embedding: () => detectEmbedding(),
    })
    // The slow answers are started as soon as collection is permitted, and
    // not before: a page loaded with consent pending reads nothing until it
    // is granted.
    if (options.sources === undefined) {
      // The durability probe takes about a second, so a page that opted into
      // extended incognito detection starts it here, once collection is
      // permitted, and identify() reads its answer.
      const warm = () => {
        warmSlowSources()
        if (options.incognitoDetection === 'extended') startDurabilityProbe()
      }
      if (client.consent === 'granted') warm()
      else client.onConsentChange((state) => state === 'granted' && warm())
    }
    resolve(client)
  })
}

export { browserSources } from './sources/index.js'
export { detectEmbedding } from './embedding.js'
export { inspectIntegrity } from './lies/index.js'

export type {
  CollectOptions,
  IdentifyOptions,
  IdentifyResult,
  IdentifySubmission,
  IdentifyTrigger,
  IntegrityReport,
  Lie,
  LieKind,
  RiskSignal,
  SignalOutcome,
  SignalReport,
  SignalStatus,
  SourceOptIn,
  SourceStage,
  WorkerRealmSignal,
} from '@fingerly/core'
export {
  Confidence,
  ConsentError,
  ConsentState,
  Continuity,
  EventState,
  FingerlyClient,
  IncognitoDetection,
  isSuspiciousLevel,
  SdkPlatform,
  SEAL_STORAGE_KEY,
  Signal,
  SOURCE,
  SuspectLevel,
  TransportError,
} from '@fingerly/core'
