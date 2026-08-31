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
   * deciding whether to show a challenge, with no interest in the server's
   * opinion. Everything the server decides comes back empty: no `requestId`,
   * no `visitorId`, and `suspectScore` is null rather than zero. That is the
   * honest answer rather than a gap - nothing was submitted, so nobody scored
   * it, and a zero would read as "scored, found nothing".
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
   * Returns the server's answer: who this visitor is, how sure it is, and what
   * the submission scored. One round trip.
   *
   * It used to return as soon as the server had a receipt, on the grounds that
   * the address lookup and the identity match could not happen in the tens of
   * milliseconds a page load can spare. They can, so they do, and a caller no
   * longer has to come back for the verdict it asked for.
   *
   * The local verdicts in [[IdentifyResult.verdicts]] are still there and are
   * still advisory - they are computed in the page, by code the visitor
   * controls. Where the two disagree, the server is the one to believe.
   */
  async identify(options: IdentifyOptions = {}): Promise<IdentifyResult> {
    const report = await this.collect(options)
    const verdicts = detectAll(report)

    if (options.submit === false) {
      // Nothing was submitted, so there is no server answer to report. Every
      // field the server would have filled is empty rather than invented,
      // because a made-up visitor here would be indistinguishable from a real
      // one to everything downstream.
      return {
        requestId: '',
        visitorId: '',
        visitorIsNew: false,
        visitorConfidence: 0,
        identifiable: false,
        duplicate: false,
        state: '',
        reason: 'not-submitted',
        suspectScore: null,
        suspectLevel: null,
        triggers: [],
        verdicts,
        report,
      }
    }

    const submission: IdentifySubmission = {
      sdk: { platform: this.platform, version: SDK_VERSION },
      signals: report,
      ...(options.tag === undefined ? {} : { tag: options.tag }),
    }

    const answer = await this.transport.submit(submission, options.signal)
    return {
      requestId: answer.request_id,
      visitorId: answer.visitor_id ?? '',
      visitorIsNew: answer.visitor_is_new ?? false,
      visitorConfidence: answer.visitor_confidence ?? 0,
      identifiable: answer.identifiable ?? false,
      duplicate: answer.duplicate ?? false,
      state: answer.state ?? '',
      reason: answer.reason ?? '',
      // Null rather than zero when the server omitted it. The server omits an
      // absent score and sends a real zero as zero, so the two survive the
      // wire; collapsing them here would undo that.
      suspectScore: answer.suspect_score ?? null,
      suspectLevel: answer.suspect_level ?? null,
      triggers: (answer.triggers ?? []).map((trigger) => ({
        signal: trigger.signal,
        group: trigger.group ?? '',
        weight: trigger.weight,
        confidence: trigger.confidence ?? '',
        reason: trigger.reason ?? '',
      })),
      verdicts,
      report,
    }
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
