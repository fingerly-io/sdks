/**
 * The single-pass v3 client every browser SDK wraps.
 */

import { assertConsentState, ConsentError } from './consent.js'
import { collect, DEFAULT_BUDGET_MS, type ScheduleOptions } from './scheduler.js'
import { own, ownCopy } from './own.js'
import { EMBEDDED_SAFE_SOURCES, SOURCE } from './signals.js'
import type { Source } from './source.js'
import {
  HttpTransport,
  INSPECT,
  readTicket,
  REDACTED,
  TransportError,
  type SubmitResponse,
  type Transport,
} from './transport.js'
import type {
  ConsentState,
  FreshnessTicket,
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
  const flag = own(source, 'embeddedSafe')
  if (flag === true) return true
  if (flag === false) return false
  return EMBEDDED_SAFE_SOURCES.has(String(own(source, 'id')))
}

function budgetOf(schedule: ScheduleOptions): number {
  const budget = own(schedule, 'budgetMs')
  return typeof budget === 'number' && Number.isFinite(budget) ? budget : DEFAULT_BUDGET_MS
}

/**
 * What the report carries when the tamper layer itself failed. A getter that
 * throws during inspection is recorded as a lie, so identification still
 * submits a report instead of rejecting (`WEB-04`).
 */
function integrityFailure(): IntegrityReport {
  return {
    patched_natives: [],
    lies: [{ id: 'integrity', kind: 'unverified_realm', detail: 'inspection-threw' }],
    engine: {},
  }
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

/** A held ticket is used only while it has at least this long left. */
export const TICKET_MARGIN_MS = 10_000

/**
 * How long a report waits, once collection is done, for a ticket request that
 * is still in flight. After that the report goes without one; the ticket, if
 * it arrives, is held for the next report.
 */
export const TICKET_GRACE_MS = 250

interface HeldTicket {
  ticket: string
  expiresAtMs: number
}

function heldTicket(value: unknown): HeldTicket | undefined {
  const read = readTicket(value)
  return read ? { ticket: read.ticket, expiresAtMs: Date.parse(read.expires_at) } : undefined
}

function lateBy<T>(ms: number, value: T): { promise: Promise<T>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(value), ms)
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

export class FingerlyClient {
  readonly #options: FingerlyClientOptions
  private readonly transport: Transport
  private readonly platform: SdkPlatform
  private consentState: ConsentState
  private readonly consentListeners = new Set<(state: ConsentState) => void>()
  /**
   * The ticket for this page's next report. In memory only: a ticket is never
   * written to any storage, so it dies with the page.
   */
  #heldTicket: HeldTicket | undefined

  constructor(input: FingerlyClientOptions) {
    // Own properties only (`WEB-09`): an option the caller did not set is
    // undefined here even when `Object.prototype` carries one of that name, so
    // a polluted `endpoints` cannot redirect the report.
    const options = ownCopy(input) as FingerlyClientOptions
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
  async identify(input: IdentifyOptions = {}): Promise<IdentifyResult> {
    this.requireConsent()
    const options = ownCopy(input) as IdentifyOptions
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
    // The ticket request runs beside collection, so it adds no round trip.
    const pendingTicket = this.ticketFor(signal)
    let sentTicket: HeldTicket | undefined
    let report: SignalReport
    try {
      report = await this.collectReport(incognitoDetection, signal)
      this.requireConsent()
      const grace = lateBy<HeldTicket | undefined>(TICKET_GRACE_MS, undefined)
      sentTicket = await Promise.race([pendingTicket, grace.promise])
      grace.cancel()
    } finally {
      // A ticket this report did not send (it came too late, or collection
      // failed) is still unused, so it is kept for the next report.
      void pendingTicket.then((ticket) => {
        if (ticket !== undefined && ticket !== sentTicket) this.holdTicket(ticket)
      })
    }

    const submission: IdentifySubmission = {
      v: 3,
      sdk: { platform: this.platform, version: SDK_VERSION },
      consent: this.consentState,
      signals: report,
      ...(typeof options.tag === 'string' && options.tag !== '' ? { tag: options.tag } : {}),
      ...(sentTicket === undefined ? {} : { ticket: sentTicket.ticket }),
    }

    let response: SubmitResponse
    try {
      response = await this.transport.submit(submission, signal)
    } catch (error) {
      this.requireConsent()
      throw consentRefusal(error)
    }

    // Own fields of the answer only (`WEB-09`): a field the server left out
    // (for example the score on a key that hides it) stays absent.
    const answer = ownCopy(response)
    if (this.platform === 'web') {
      const next = heldTicket(answer.next_ticket)
      if (next) this.holdTicket(next)
    }
    const visitorId = typeof answer.visitor_id === 'string' ? answer.visitor_id : ''
    // The report is not part of the result (`WEB-14`): it describes the
    // device, and callers that keep the result in application state would
    // keep it too. `collect()` returns it for debugging.
    return {
      requestId: typeof answer.request_id === 'string' ? answer.request_id : '',
      visitorId,
      visitorIsNew: visitorId === '' ? false : answer.visitor_is_new === true,
      visitorConfidence:
        visitorId === '' ||
        typeof answer.visitor_confidence !== 'number' ||
        !Number.isFinite(answer.visitor_confidence)
          ? 0
          : answer.visitor_confidence,
      identifiable: answer.identifiable === true,
      duplicate: answer.duplicate === true,
      state: typeof answer.state === 'string' ? answer.state : '',
      suspectScore:
        typeof answer.suspect_score === 'number' && Number.isFinite(answer.suspect_score)
          ? answer.suspect_score
          : null,
      suspectLevel: isSuspectLevel(answer.suspect_level) ? answer.suspect_level : null,
    }
  }

  /**
   * The ticket for one report: the held one while it has more than
   * [[TICKET_MARGIN_MS]] left, otherwise a fresh request. Resolves to
   * `undefined` on any failure and never rejects, so a ticket can never block
   * or fail identification. Native platforms never carry a ticket.
   */
  private ticketFor(signal: AbortSignal): Promise<HeldTicket | undefined> {
    if (this.platform !== 'web') return Promise.resolve(undefined)

    // Single use: a held ticket is taken, so a concurrent call cannot send it too.
    const held = this.#heldTicket
    this.#heldTicket = undefined
    if (held && held.expiresAtMs - Date.now() > TICKET_MARGIN_MS) return Promise.resolve(held)

    const transport = this.transport
    if (typeof transport.ticket !== 'function') return Promise.resolve(undefined)
    try {
      return Promise.resolve(
        transport.ticket({ v: 3, op: 'ticket', sdk: { platform: 'web', version: SDK_VERSION } }, signal),
      ).then(
        (answer: FreshnessTicket) => heldTicket(answer),
        () => undefined,
      )
    } catch {
      return Promise.resolve(undefined)
    }
  }

  private holdTicket(ticket: HeldTicket): void {
    const current = this.#heldTicket
    if (!current || ticket.expiresAtMs > current.expiresAtMs) this.#heldTicket = ticket
  }

  /**
   * Run the sources and assemble the report locally, without submitting.
   */
  async collect(input: CollectOptions = {}): Promise<SignalReport> {
    this.requireConsent()
    const options = ownCopy(input) as CollectOptions
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
    const outerFilter = own(this.#options.schedule, 'filter')
    const filter = embeddedKind
      ? (source: Source) =>
          isEmbeddedSafeSource(source) && (outerFilter ? outerFilter(source) : true)
      : outerFilter

    const effectiveIncognito: IncognitoDetection = embeddedKind ? 'standard' : incognitoDetection

    const schedule: ScheduleOptions = {
      ...ownCopy(this.#options.schedule),
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

    // The tamper layer reads page globals that an earlier script controls. A
    // getter that throws there must not reject identification (`WEB-04`).
    let integrity: IntegrityReport
    try {
      integrity = this.#options.integrity
        ? this.#options.integrity({ sources: outcomes })
        : EMPTY_INTEGRITY
    } catch {
      integrity = integrityFailure()
    }

    return {
      schema: SCHEMA_VERSION,
      budget_ms: budgetOf(schedule),
      elapsed_ms: result.elapsedMs,
      sources: outcomes,
      integrity,
    }
  }
}
