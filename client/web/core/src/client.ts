/**
 * The client every SDK wraps.
 *
 * It knows how to run a source set under a budget, turn the outcomes into a
 * report, and submit it. It does not know what a source is or where one comes
 * from - `@fingerly/web-js` supplies the browser set, the mobile SDKs will supply
 * theirs - which is what keeps this file free of anything platform-specific.
 */

import { assertConsentState, ConsentError } from './consent.js'
import { detectAll } from './detect/index.js'
import { collect, type ScheduleOptions } from './scheduler.js'
import type { Source } from './source.js'
import { HttpTransport, type SubmitResponse, type Transport } from './transport.js'
import type {
  ConsentState,
  IdentifyResult,
  IdentifySubmission,
  DeferredIdentifyResult,
  DeferredSubmission,
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

export interface FingerlyClientOptions {
  /** API route version. Defaults to v1; the server must support it. */
  apiVersion?: string
  /** The SDK key, from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** Origin of the API. Defaults to production. */
  endpoint?: string
  /** Ordered first-party ingestion endpoints. */
  endpoints?: string | readonly string[]
  /** Explicitly use the regional Fingerly API after custom endpoints fail. */
  fallbackToDefaultEndpoint?: boolean
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
  /**
   * Whether the visitor has agreed to be identified. Defaults to `granted`.
   *
   * Pass `pending` when identification waits on a consent banner, and call
   * [[FingerlyClient.setConsent]] once it is answered. Until then `identify()`
   * and `collect()` run no source and send nothing, and fail with a
   * [[ConsentError]].
   */
  consent?: ConsentState
}

export interface IdentifyOptions {
  /** Echoed back on the finished event, for the caller's own correlation. */
  tag?: string
  /** Which tiers to run in one shot. Omit for the default initial/deferred split. */
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

export class FingerlyClient {
  private readonly options: FingerlyClientOptions
  private readonly transport: Transport
  private readonly platform: SdkPlatform
  private consentState: ConsentState
  private readonly consentListeners = new Set<(state: ConsentState) => void>()

  constructor(options: FingerlyClientOptions) {
    const consent = options.consent ?? 'granted'
    assertConsentState(consent)
    this.consentState = consent
    this.options = options
    this.platform = options.platform ?? 'web'
    this.transport =
      options.transport ??
      new HttpTransport({
        ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
        apiKey: options.apiKey,
        ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
        ...(options.endpoints === undefined ? {} : { endpoints: options.endpoints }),
        ...(options.fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint: options.fallbackToDefaultEndpoint }),
      })
  }

  /** Whether the visitor has agreed to be identified. See [[setConsent]]. */
  get consent(): ConsentState {
    return this.consentState
  }

  /**
   * Record the visitor's answer, as the consent tool reports it.
   *
   * Synchronous, and safe to call as often as a consent tool likes: setting the
   * state the client already has changes nothing and notifies nobody. It
   * applies to the next call and to any call already in flight - withdrawing
   * consent stops a running `identify()` from starting further sources or
   * submitting, and stops its deferred supplement from being sent.
   */
  setConsent(state: ConsentState): void {
    assertConsentState(state)
    if (state === this.consentState) return
    this.consentState = state

    // A copy, so a listener that unsubscribes as it runs does not perturb the
    // loop. Each is isolated from the others: the in-flight calls cancel
    // themselves through this same set, and one customer listener throwing
    // must not leave a withdrawn call free to submit. The error is rethrown
    // on a clean stack so it is still reported.
    for (const listener of [...this.consentListeners]) {
      try {
        listener(state)
      } catch (error) {
        setTimeout(() => {
          throw error
        }, 0)
      }
    }
  }

  /**
   * Be told when consent changes. Returns the unsubscribe.
   *
   * Called on a change only, never with the state at the moment of
   * subscribing - read [[consent]] for that. This is what the framework
   * bindings use to start an automatic identification once a banner is
   * accepted.
   */
  onConsentChange(listener: (state: ConsentState) => void): () => void {
    this.consentListeners.add(listener)
    return () => {
      this.consentListeners.delete(listener)
    }
  }

  /** Throws unless consent is granted. */
  private requireConsent(): void {
    if (this.consentState !== 'granted') throw new ConsentError(this.consentState)
  }

  /**
   * A signal for one call that aborts when the caller's does, or when consent
   * stops being granted.
   *
   * Handed to the scheduler, so a withdrawal starts no further source and
   * cancels the ones running, and to the transport, so it sends no retry and
   * abandons the request in flight. `close()` must run when the call settles,
   * or every finished call stays subscribed.
   */
  private consentScope(signal: AbortSignal | undefined): { signal: AbortSignal; close(): void } {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const unsubscribe = this.onConsentChange((state) => {
      if (state !== 'granted') abort()
    })
    return {
      signal: controller.signal,
      close: () => {
        unsubscribe()
        signal?.removeEventListener('abort', abort)
      },
    }
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
   *
   * Fails with a [[ConsentError]], before any source runs, while consent is
   * not granted - and again if consent is withdrawn before the submission.
   */
  async identify(options: IdentifyOptions = {}): Promise<IdentifyResult> {
    this.requireConsent()
    const scope = this.consentScope(options.signal)
    try {
      return await this.identifyWithConsent(options, scope.signal)
    } finally {
      scope.close()
    }
  }

  private async identifyWithConsent(options: IdentifyOptions, signal: AbortSignal): Promise<IdentifyResult> {
    const automaticDeferred = options.submit !== false && options.tiers === undefined
    const report = await this.collectReport(
      automaticDeferred ? ['fast'] : (options.tiers ?? ['fast', 'deferred']),
      signal,
      automaticDeferred ? 300 : undefined,
    )
    // Withdrawn while the sources ran. Checked here rather than beside the
    // submission because nothing between the two awaits: this is the last
    // moment the answer can change before the request is made, and it also
    // keeps a `submit: false` caller from receiving a report collected after
    // the visitor said no.
    this.requireConsent()
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
        deferred: Promise.resolve({ status: 'skipped', reason: 'not-submitted' }),
      }
    }

    const submission: IdentifySubmission = {
      sdk: { platform: this.platform, version: SDK_VERSION },
      signals: report,
      ...(options.tag === undefined ? {} : { tag: options.tag }),
    }

    let answer: SubmitResponse
    try {
      answer = await this.transport.submit(submission, signal)
    } catch (error) {
      // A withdrawal aborts the request, which the transport reports as a
      // cancellation. Say what actually happened.
      this.requireConsent()
      throw error
    }
    const result: IdentifyResult = {
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
      deferred: Promise.resolve({ status: 'skipped', reason: 'explicit-tiers' }),
    }


    if (!automaticDeferred) return result
    if (answer.duplicate || !answer.deferred_token) {
      result.deferred = Promise.resolve({
        status: 'skipped',
        reason: answer.duplicate ? 'duplicate' : 'unsupported-transport',
      })
      return result
    }
    if (typeof this.transport.submitSupplement !== 'function') {
      result.deferred = Promise.resolve({ status: 'skipped', reason: 'unsupported-transport' })
      return result
    }

    result.deferred = this.finishDeferred(report, answer.request_id, answer.deferred_token, options.signal)
    return result
  }

  private async finishDeferred(
    initial: SignalReport,
    requestId: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<DeferredIdentifyResult> {
    // Skipped rather than failed: nothing went wrong, the visitor changed
    // their answer, and a caller logging failures should not see one.
    const withdrawn: DeferredIdentifyResult = { status: 'skipped', reason: 'consent-withdrawn' }
    if (this.consentState !== 'granted') return withdrawn

    const scope = this.consentScope(signal)
    let report: SignalReport | undefined
    let combinedReport: SignalReport | undefined
    let verdicts: ReturnType<typeof detectAll> | undefined
    try {
      report = await this.collectReport(['deferred'], scope.signal, 1200, initial.sources)
      // Nothing below awaits before the supplement is sent, so this is the
      // check immediately before it.
      if (this.consentState !== 'granted') return withdrawn
      combinedReport = {
        schema: initial.schema,
        budget_ms: initial.budget_ms + report.budget_ms,
        elapsed_ms: initial.elapsed_ms + report.elapsed_ms,
        tiers: ['fast', 'deferred'],
        sources: { ...initial.sources, ...report.sources },
        integrity: this.options.integrity
          ? this.options.integrity({ sources: { ...initial.sources, ...report.sources } })
          : EMPTY_INTEGRITY,
      }
      verdicts = detectAll(combinedReport)
      const submission: DeferredSubmission = {
        sdk: { platform: this.platform, version: SDK_VERSION },
        signals: report,
        token,
      }
      await this.transport.submitSupplement!(requestId, submission, scope.signal)
      return { status: 'submitted', report, combinedReport, verdicts }
    } catch (error) {
      // The supplement was abandoned because consent was withdrawn mid-flight.
      if (this.consentState !== 'granted') return withdrawn
      return {
        status: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
        ...(report === undefined ? {} : { report }),
        ...(combinedReport === undefined ? {} : { combinedReport }),
        ...(verdicts === undefined ? {} : { verdicts }),
      }
    } finally {
      scope.close()
    }
  }

  /**
   * Run the sources and assemble the report, without submitting.
   *
   * Public because it is genuinely useful on its own - a debug page, a test
   * harness, or a customer who wants to see exactly what would be sent before
   * they agree to send it.
   *
   * Consent applies here too, although nothing is sent: collecting is itself
   * the reading of the device that consent covers. Fails with a
   * [[ConsentError]] while consent is not granted, or if it is withdrawn
   * while the sources run.
   */
  async collect(options: IdentifyOptions = {}): Promise<SignalReport> {
    this.requireConsent()
    const tiers: SourceTier[] = options.tiers ?? ['fast', 'deferred']

    const scope = this.consentScope(options.signal)
    try {
      const report = await this.collectReport(tiers, scope.signal)
      this.requireConsent()
      return report
    } finally {
      scope.close()
    }
  }

  private async collectReport(
    tiers: SourceTier[],
    signal?: AbortSignal,
    budgetMs?: number,
    completed?: Readonly<Record<string, SignalReport['sources'][string]>>,
  ): Promise<SignalReport> {
    const sources = this.options.sources ?? []

    const schedule: ScheduleOptions = {
      ...this.options.schedule,
      tiers,
      ...(budgetMs === undefined ? {} : { budgetMs }),
      ...(signal === undefined ? {} : { signal }),
      ...(completed === undefined ? {} : { completed }),
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
