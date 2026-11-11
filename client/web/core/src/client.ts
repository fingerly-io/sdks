/**
 * The client every SDK wraps.
 *
 * It knows how to run a source set under a budget, turn the outcomes into a
 * report, and submit it. It does not know what a source is or where one comes
 * from - `@fingerly/web-js` supplies the browser set, the mobile SDKs will supply
 * theirs - which is what keeps this file free of anything platform-specific.
 */

import { assertConsentState, ConsentError } from './consent.js'
import { collect, type ScheduleOptions } from './scheduler.js'
import type { Source } from './source.js'
import { HttpTransport, INSPECT, REDACTED, TransportError, type SubmitResponse, type Transport } from './transport.js'
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
import { SOURCE } from './signals.js'

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
  /**
   * Ordered first-party ingestion URLs, posted to exactly as given, such as
   * `/k7x2qm4a` for the proxy path the dashboard issued. See
   * `HttpTransportOptions.endpoints`.
   */
  endpoints?: string | readonly string[]
  /** Explicitly use the Fingerly API after custom endpoints fail. */
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
   * Says whether the page is running inside an app, and as what. Supplied by
   * the platform SDK, which can see the page; `@fingerly/web-js` sets it and a
   * caller of `load()` cannot replace it.
   *
   * When it names a kind, no source runs: the report carries only the
   * `embedding` source, and no deferred report follows. Called only once
   * consent is granted, because looking is itself a read of the device.
   */
  embedding?: () => string | undefined
  /**
   * Whether the visitor has agreed to be identified. Defaults to `pending`.
   *
   * Leave it `pending` when identification waits on a consent banner, and call
   * [[FingerlyClient.setConsent]] once it is answered. Until then `identify()`
   * and `collect()` run no source and send nothing, and fail with a
   * [[ConsentError]]. Pass `granted` only once the visitor has agreed, or
   * where you have established that this visitor needs none (a GDPR lawful basis does not replace it; see docs/privacy.md §4).
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
   * Collect without sending anything.
   *
   * Everything the server decides comes back empty: no `requestId`, no
   * `visitorId`, and `suspectScore` and `suspectLevel` null rather than zero.
   * That is the honest answer rather than a gap - nothing was submitted, so
   * nobody scored it, and this client decides nothing on its own.
   */
  submit?: boolean
}

/**
 * The server's `422 consent_required`, as the error the client throws itself.
 *
 * It should never happen: the client sends only while consent is `granted`,
 * and says so in the body. A custom transport or a proxy that rewrites the
 * body could still provoke it, and a caller handling consent failures should
 * see this one the same way. Reported as `pending` rather than the client's
 * own `granted`: the server has no record of consent for this submission,
 * and an error saying consent was granted would contradict its own message.
 */
function consentRefusal(error: unknown): unknown {
  return error instanceof TransportError && error.code === 'consent_required' ? new ConsentError('pending') : error
}

/** Once per page is enough to tell an integrator; every call would be noise. */
let embeddingWarned = false

/** Only for tests, which need to see the warning more than once. */
export function resetEmbeddingWarning(): void {
  embeddingWarned = false
}

function warnEmbedded(kind: string): void {
  if (embeddingWarned) return
  embeddingWarned = true
  console.warn(
    `Fingerly: this page is running inside an app (${kind}), so the browser SDK collected nothing. ` +
      'Use the Fingerly iOS or Android SDK in apps.',
  )
}

/** No sources ran, so nothing was found. Distinct from "found nothing". */
const EMPTY_INTEGRITY: IntegrityReport = {
  patched_natives: [],
  lies: [],
  engine: {},
}

export class FingerlyClient {
  /** Holds the key, so kept out of enumeration, JSON and inspection. */
  readonly #options: FingerlyClientOptions
  private readonly transport: Transport
  private readonly platform: SdkPlatform
  private consentState: ConsentState
  private readonly consentListeners = new Set<(state: ConsentState) => void>()

  constructor(options: FingerlyClientOptions) {
    const consent = options.consent ?? 'pending'
    assertConsentState(consent)
    this.consentState = consent
    this.#options = options
    this.platform = options.platform ?? 'web'
    this.transport =
      options.transport ??
      new HttpTransport({
        ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
        apiKey: options.apiKey,
        ...(options.endpoints === undefined ? {} : { endpoints: options.endpoints }),
        ...(options.fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint: options.fallbackToDefaultEndpoint }),
      })
  }

  /** What `JSON.stringify` shows: never the key. */
  toJSON(): Record<string, unknown> {
    return { apiKey: REDACTED, platform: this.platform, consent: this.consentState, transport: this.transport instanceof HttpTransport ? this.transport : 'custom' }
  }

  /** What Node's `util.inspect` and `console.log` show. */
  [INSPECT](): Record<string, unknown> {
    return this.toJSON()
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
   * Collect and submit.
   *
   * Returns the server's answer: who this visitor is, how sure it is, and what
   * the submission scored. One round trip. Nothing about the answer is
   * decided in the page: the score and level are what the server sent, and
   * are absent, not zero, when it sent none. Signals are read on your backend.
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
    const embedded = this.embeddedReport()
    const automaticDeferred = !embedded && options.submit !== false && options.tiers === undefined
    const report = embedded ?? await this.collectReport(
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

    if (options.submit === false) {
      // Nothing was submitted, so there is no server answer to report. Every
      // field the server would have filled is empty rather than invented,
      // because a made-up visitor here would be indistinguishable from a real
      // one to everything downstream. The report is the whole result: this
      // client decides nothing on its own.
      return {
        requestId: '',
        visitorId: '',
        visitorIsNew: false,
        visitorConfidence: 0,
        identifiable: false,
        duplicate: false,
        state: '',
        suspectScore: null,
        suspectLevel: null,
        report,
        deferred: Promise.resolve({ status: 'skipped', reason: 'not-submitted' }),
      }
    }

    const submission: IdentifySubmission = {
      sdk: { platform: this.platform, version: SDK_VERSION },
      // The state at the moment of sending, which the check above makes
      // `granted`. The server refuses a submission without it.
      consent: this.consentState,
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
      throw consentRefusal(error)
    }
    const result: IdentifyResult = {
      requestId: answer.request_id,
      visitorId: answer.visitor_id ?? '',
      visitorIsNew: answer.visitor_is_new ?? false,
      visitorConfidence: answer.visitor_confidence ?? 0,
      identifiable: answer.identifiable ?? false,
      duplicate: answer.duplicate ?? false,
      state: answer.state ?? '',
      // No `reason`. The server tells only a secret key why a submission went
      // unscored; a browser's backend reads it on the event.
      // Null rather than zero when the server omitted it, unscored or hidden
      // alike. The server sends a real zero as zero, so the two survive the
      // wire; collapsing them here would undo that. The two are read apart so
      // a proxy that kept only one does not lose it.
      suspectScore: typeof answer.suspect_score === 'number' && Number.isFinite(answer.suspect_score) ? answer.suspect_score : null,
      suspectLevel: typeof answer.suspect_level === 'string' && answer.suspect_level !== '' ? answer.suspect_level : null,
      report,
      deferred: Promise.resolve({ status: 'skipped', reason: 'explicit-tiers' }),
    }

    if (embedded) {
      // Nothing may follow a report from inside an app, least of all the
      // expensive sources the deferred report carries. `not-submitted` is the
      // literal truth and an existing reason in the shared contract, which
      // this change leaves alone.
      result.deferred = Promise.resolve({ status: 'skipped', reason: 'not-submitted' })
      return result
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
        integrity: this.#options.integrity
          ? this.#options.integrity({ sources: { ...initial.sources, ...report.sources } })
          : EMPTY_INTEGRITY,
      }
      const submission: DeferredSubmission = {
        sdk: { platform: this.platform, version: SDK_VERSION },
        consent: this.consentState,
        signals: report,
        token,
      }
      await this.transport.submitSupplement!(requestId, submission, scope.signal)
      return { status: 'submitted', report, combinedReport }
    } catch (error) {
      // The supplement was abandoned because consent was withdrawn mid-flight.
      if (this.consentState !== 'granted') return withdrawn
      const failure = consentRefusal(error)
      return {
        status: 'failed',
        error: failure instanceof Error ? failure : new Error(String(failure)),
        ...(report === undefined ? {} : { report }),
        ...(combinedReport === undefined ? {} : { combinedReport }),
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

    const embedded = this.embeddedReport()
    if (embedded) return embedded

    const scope = this.consentScope(options.signal)
    try {
      const report = await this.collectReport(tiers, scope.signal)
      this.requireConsent()
      return report
    } finally {
      scope.close()
    }
  }

  /**
   * The whole report for a page inside an app, or undefined in a browser.
   *
   * Asked only after the consent check: the detector reads the page, which is
   * a read of the device like any source.
   */
  private embeddedReport(): SignalReport | undefined {
    const kind = this.#options.embedding?.()
    if (!kind) return undefined
    warnEmbedded(kind)
    return {
      schema: SCHEMA_VERSION,
      budget_ms: 0,
      elapsed_ms: 0,
      tiers: ['fast'],
      sources: { [SOURCE.embedding]: { status: 'ok', ms: 0, value: { kind } } },
      integrity: EMPTY_INTEGRITY,
    }
  }

  private async collectReport(
    tiers: SourceTier[],
    signal?: AbortSignal,
    budgetMs?: number,
    completed?: Readonly<Record<string, SignalReport['sources'][string]>>,
  ): Promise<SignalReport> {
    const sources = this.#options.sources ?? []

    const schedule: ScheduleOptions = {
      ...this.#options.schedule,
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
    const integrity = this.#options.integrity
      ? this.#options.integrity({ sources: result.outcomes })
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
