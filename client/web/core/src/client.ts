/**
 * The single-pass v3 client every browser SDK wraps.
 */

import { assertConsentState, ConsentError } from './consent.js'
import { collect, DEFAULT_BUDGET_MS, type ScheduleOptions } from './scheduler.js'
import { EMBEDDED_SAFE_SOURCES, SOURCE } from './signals.js'
import type { Source } from './source.js'
import {
  HttpTransport,
  INSPECT,
  REDACTED,
  TransportError,
  type SubmitResponse,
  type Transport,
} from './transport.js'
import type {
  ConsentState,
  IdentifyResult,
  IdentifySubmission,
  IncognitoDetection,
  IntegrityReport,
  SdkPlatform,
  SignalOutcome,
  SignalReport,
  SuspectLevel,
} from './types.js'
import { SDK_VERSION } from './version.js'

export const SCHEMA_VERSION = 1

export interface FingerlyClientOptions {
  /** API route version. Defaults to v1. */
  apiVersion?: string
  /** The SDK key, from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** Ordered first-party ingestion URLs. */
  endpoints?: string | readonly string[]
  /** Explicitly use the Fingerly API after custom endpoints fail. */
  fallbackToDefaultEndpoint?: boolean
  /** Which platform this SDK reports as. Set by the wrapping package. */
  platform?: SdkPlatform
  /** The sources to run. Supplied by `@fingerly/web-js`. */
  sources?: readonly Source[]
  /** Produces the tamper findings. Supplied by `@fingerly/web-js`. */
  integrity?: (report: Pick<SignalReport, 'sources'>) => IntegrityReport
  /** Overrides for the scheduler. */
  schedule?: ScheduleOptions
  /** Replaced in tests, and by any SDK that has its own network stack. */
  transport?: Transport
  /**
   * Detects whether the page is running inside an in-app WebView. When a kind
   * is returned, only DPLA-safe non-identifying runtime/integrity sources run,
   * while device-fingerprinting sources are skipped (`F-01`).
   */
  embedding?: () => string | undefined
  /** Whether the visitor has agreed to be identified. Defaults to `pending`. */
  consent?: ConsentState
  /** Default incognito detection mode (`'standard'` or `'extended'`). */
  incognitoDetection?: IncognitoDetection
}

export interface CollectOptions {
  /** Cancels collection. */
  signal?: AbortSignal
  /**
   * Controls whether opt-in extended incognito probes (`storage_durability`)
   * execute. Defaults to `'standard'`.
   */
  incognitoDetection?: IncognitoDetection
}

export interface IdentifyOptions extends CollectOptions {
  /** Echoed back on the finished event, for the caller's own correlation. */
  tag?: string
}

function consentRefusal(error: unknown): unknown {
  return error instanceof TransportError && error.code === 'consent_required'
    ? new ConsentError('pending')
    : error
}

function isSuspectLevel(value: unknown): value is SuspectLevel {
  return value === 'low' || value === 'medium' || value === 'high'
}

function isEmbeddedSafeSource(source: Source): boolean {
  if (source.embeddedSafe === true) return true
  if (source.embeddedSafe === false) return false
  return EMBEDDED_SAFE_SOURCES.has(source.id)
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
    `Fingerly: this page is running inside an app (${kind}), so device-fingerprinting collectors were skipped. ` +
      'Use the Fingerly iOS or Android SDK in apps.',
  )
}

const EMPTY_INTEGRITY: IntegrityReport = {
  patched_natives: [],
  lies: [],
  engine: {},
}

export class FingerlyClient {
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
        ...(options.fallbackToDefaultEndpoint === undefined
          ? {}
          : { fallbackToDefaultEndpoint: options.fallbackToDefaultEndpoint }),
      })
  }

  toJSON(): Record<string, unknown> {
    return {
      apiKey: REDACTED,
      platform: this.platform,
      consent: this.consentState,
      transport: this.transport instanceof HttpTransport ? this.transport : 'custom',
    }
  }

  [INSPECT](): Record<string, unknown> {
    return this.toJSON()
  }

  get consent(): ConsentState {
    return this.consentState
  }

  setConsent(state: ConsentState): void {
    assertConsentState(state)
    if (state === this.consentState) return
    this.consentState = state

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

  onConsentChange(listener: (state: ConsentState) => void): () => void {
    this.consentListeners.add(listener)
    return () => {
      this.consentListeners.delete(listener)
    }
  }

  private requireConsent(): void {
    if (this.consentState !== 'granted') throw new ConsentError(this.consentState)
  }

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
   * Collect and submit in a single `v: 3` round trip.
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

  private async identifyWithConsent(
    options: IdentifyOptions,
    signal: AbortSignal,
  ): Promise<IdentifyResult> {
    const incognitoDetection =
      options.incognitoDetection ?? this.#options.incognitoDetection ?? 'standard'
    const report = await this.collectReport(incognitoDetection, signal)

    this.requireConsent()

    const submission: IdentifySubmission = {
      v: 3,
      sdk: { platform: this.platform, version: SDK_VERSION },
      consent: this.consentState,
      signals: report,
      ...(options.tag === undefined || options.tag === '' ? {} : { tag: options.tag }),
    }

    let answer: SubmitResponse
    try {
      answer = await this.transport.submit(submission, signal)
    } catch (error) {
      this.requireConsent()
      throw consentRefusal(error)
    }

    const visitorId = typeof answer.visitor_id === 'string' ? answer.visitor_id : ''
    return {
      requestId: answer.request_id,
      visitorId,
      visitorIsNew: visitorId === '' ? false : (answer.visitor_is_new ?? false),
      visitorConfidence: visitorId === '' ? 0 : (answer.visitor_confidence ?? 0),
      identifiable: answer.identifiable ?? false,
      duplicate: answer.duplicate ?? false,
      state: answer.state ?? '',
      suspectScore:
        typeof answer.suspect_score === 'number' && Number.isFinite(answer.suspect_score)
          ? answer.suspect_score
          : null,
      suspectLevel: isSuspectLevel(answer.suspect_level) ? answer.suspect_level : null,
      report,
    }
  }

  /**
   * Run the sources and assemble the report locally, without submitting.
   */
  async collect(options: CollectOptions = {}): Promise<SignalReport> {
    this.requireConsent()
    const scope = this.consentScope(options.signal)
    try {
      const incognitoDetection =
        options.incognitoDetection ?? this.#options.incognitoDetection ?? 'standard'
      const report = await this.collectReport(incognitoDetection, scope.signal)
      this.requireConsent()
      return report
    } finally {
      scope.close()
    }
  }

  private async collectReport(
    incognitoDetection: IncognitoDetection,
    signal?: AbortSignal,
  ): Promise<SignalReport> {
    const embeddedKind = this.#options.embedding?.()
    if (embeddedKind) {
      warnEmbedded(embeddedKind)
    }

    const sources = this.#options.sources ?? []
    const outerFilter = this.#options.schedule?.filter
    const filter = embeddedKind
      ? (source: Source) =>
          isEmbeddedSafeSource(source) && (outerFilter ? outerFilter(source) : true)
      : outerFilter

    const effectiveIncognito: IncognitoDetection = embeddedKind ? 'standard' : incognitoDetection

    const schedule: ScheduleOptions = {
      ...this.#options.schedule,
      incognitoDetection: effectiveIncognito,
      ...(filter === undefined ? {} : { filter }),
      ...(signal === undefined ? {} : { signal }),
    }

    const result = await collect(sources, schedule)
    const outcomes: Record<string, SignalOutcome> = { ...result.outcomes }

    if (embeddedKind) {
      outcomes[SOURCE.embedding] = {
        status: 'ok',
        ms: 0,
        value: { kind: embeddedKind },
      }
    }

    const integrity = this.#options.integrity
      ? this.#options.integrity({ sources: outcomes })
      : EMPTY_INTEGRITY

    return {
      schema: SCHEMA_VERSION,
      budget_ms: schedule.budgetMs ?? DEFAULT_BUDGET_MS,
      elapsed_ms: result.elapsedMs,
      sources: outcomes,
      integrity,
    }
  }
}
