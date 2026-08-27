/**
 * The client every SDK wraps.
 *
 * It knows how to run a source set under a budget, turn the outcomes into a
 * report, and submit it. It does not know what a source is or where one comes
 * from - `@badele/web-js` supplies the browser set, the mobile SDKs will supply
 * theirs - which is what keeps this file free of anything platform-specific.
 */

import { detectAll } from './detect/index.js'
import { collect, type ScheduleOptions } from './scheduler.js'
import type { Source } from './source.js'
import { HttpTransport, type Transport } from './transport.js'
import type {
  IdentifyResult,
  IdentifySubmission,
  IntegrityReport,
  SdkPlatform,
  SignalReport,
  SourceTier,
} from './types.js'
import { SDK_VERSION } from './version.js'

/**
 * The report schema version.
 *
 * Bumped when a field changes meaning, never when one is added. A consumer
 * reading a stored report needs to know whether `storage.quota` meant the same
 * thing when it was written; a new source appearing does not affect that.
 */
export const SCHEMA_VERSION = 1

export interface BadeleClientOptions {
  /** The SDK key, from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** Origin of the API. Defaults to production. */
  endpoint?: string
  /** Which platform this SDK reports as. Set by the wrapping package. */
  platform?: SdkPlatform
  /** The sources to run. Empty here; supplied by the platform SDK. */
  sources?: readonly Source[]
  /** Produces the tamper findings. Supplied by the platform SDK. */
  integrity?: (report: Pick<SignalReport, 'sources'>) => IntegrityReport
  /** Overrides for the scheduler. */
  schedule?: ScheduleOptions
  /** Replaced in tests, and by any SDK that has its own network stack. */
  transport?: Transport
}

export interface IdentifyOptions {
  /** Echoed back on the finished event, for the caller's own correlation. */
  tag?: string
  /** Which tiers to run. Defaults to both. */
  tiers?: SourceTier[]
  /** Cancels collection and submission. */
  signal?: AbortSignal
  /**
   * Collect and score without sending anything.
   *
   * For a caller that wants the local verdicts and nothing else - a page
   * deciding whether to show a challenge, with no interest in the enriched
   * event. `requestId` comes back empty, which is the honest answer: nothing
   * was submitted, so there is nothing to fetch later.
   */
  submit?: boolean
}

/** No sources ran, so nothing was found. Distinct from "found nothing". */
const EMPTY_INTEGRITY: IntegrityReport = {
  patched_natives: [],
  lies: [],
  engine: {},
}

export class BadeleClient {
  private readonly options: BadeleClientOptions
  private readonly transport: Transport
  private readonly platform: SdkPlatform

  constructor(options: BadeleClientOptions) {
    this.options = options
    this.platform = options.platform ?? 'web'
    this.transport =
      options.transport ??
      new HttpTransport(
        options.endpoint === undefined
          ? { apiKey: options.apiKey }
          : { apiKey: options.apiKey, endpoint: options.endpoint },
      )
  }

  /**
   * Collect, score locally, and submit.
   *
   * Returns as soon as the server has a receipt. It does not wait for the
   * enriched event, because IP geolocation and the velocity windows take far
   * longer than a page should block for - that is the two-phase design the
   * server's `202` and `services.Identifier` are built around. Callers that
   * need the finished event fetch it separately by `requestId`.
   */
  async identify(options: IdentifyOptions = {}): Promise<IdentifyResult> {
    const report = await this.collect(options)
    const verdicts = detectAll(report)

    if (options.submit === false) {
      return { requestId: '', verdicts, report }
    }

    const submission: IdentifySubmission = {
      sdk: { platform: this.platform, version: SDK_VERSION },
      signals: report,
      ...(options.tag === undefined ? {} : { tag: options.tag }),
    }

    const receipt = await this.transport.submit(submission, options.signal)
    return { requestId: receipt.request_id, verdicts, report }
  }

  /**
   * Run the sources and assemble the report, without submitting.
   *
   * Public because it is genuinely useful on its own - a debug page, a test
   * harness, or a customer who wants to see exactly what would be sent before
   * they agree to send it.
   */
  async collect(options: IdentifyOptions = {}): Promise<SignalReport> {
    const sources = this.options.sources ?? []
    const tiers: SourceTier[] = options.tiers ?? ['fast', 'deferred']

    const schedule: ScheduleOptions = {
      ...this.options.schedule,
      tiers,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }

    const result = await collect(sources, schedule)

    // Integrity runs after collection, not as a source, because it reads what
    // the other sources produced - the contradiction checks need the whole set
    // - and because a tamper check that was itself scheduled could be starved
    // by the budget, which is precisely the outcome an attacker would want.
    const integrity = this.options.integrity
      ? this.options.integrity({ sources: result.outcomes })
      : EMPTY_INTEGRITY

    return {
      schema: SCHEMA_VERSION,
      budget_ms: schedule.budgetMs ?? 1200,
      elapsed_ms: result.elapsedMs,
      tiers,
      sources: result.outcomes,
      integrity,
    }
  }
}
