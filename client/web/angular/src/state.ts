/**
 * The shared state, in Angular signals (`0.3.0`, single-pass `v: 3`).
 */

import { computed, signal, type Signal } from '@angular/core'
import {
  isSuspiciousLevel,
  load,
  type ConsentState,
  type FingerlyClient,
  type IdentifyResult,
  type IncognitoDetection,
  type SignalReport,
  type SuspectLevel,
} from '@fingerly/web-js'

/** Options for [[provideFingerly]]. */
export interface FingerlyOptions {
  /** The SDK key from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** API route version. Defaults to v1. */
  apiVersion?: string
  /** Ordered first-party ingestion endpoints. */
  endpoints?: string | readonly string[]
  fallbackToDefaultEndpoint?: boolean
  /**
   * Controls whether opt-in extended incognito probes (`storage_durability`)
   * execute (`'standard'` default or `'extended'`).
   */
  incognitoDetection?: IncognitoDetection
  /** Whether the visitor has agreed to be identified. Defaults to `pending`. */
  consent?: ConsentState
}

/** What a component injects. Every field is a signal; none of them is writable. */
export interface Fingerly {
  readonly requestId: Signal<string | null>
  /**
   * `null` before the first identification; afterwards `result.visitorId`
   * (`""` when `identifiable === false` under Option B).
   */
  readonly visitorId: Signal<string | null>
  readonly visitorIsNew: Signal<boolean>
  readonly visitorConfidence: Signal<number>
  readonly identifiable: Signal<boolean>
  readonly duplicate: Signal<boolean>
  readonly state: Signal<string | null>
  readonly suspectScore: Signal<number | null>
  readonly suspectLevel: Signal<SuspectLevel | null>
  readonly report: Signal<SignalReport | null>
  readonly error: Signal<Error | null>
  readonly isLoading: Signal<boolean>
  readonly isReady: Signal<boolean>
  readonly isSuspicious: Signal<boolean | null>
  readonly consent: Signal<ConsentState>
  setConsent(state: ConsentState): void
  identify(options?: {
    tag?: string
    incognitoDetection?: IncognitoDetection
    force?: boolean
    automatic?: boolean
  }): Promise<IdentifyResult>
  refresh(options?: {
    tag?: string
    incognitoDetection?: IncognitoDetection
  }): Promise<IdentifyResult>
  client(): Promise<FingerlyClient>
}

/** Thrown when the SDK is asked to collect somewhere there is no browser. */
export class FingerlyServerError extends Error {
  override readonly name = 'FingerlyServerError'
  constructor() {
    super(
      'Fingerly collects signals from a browser and cannot run during server-side rendering. ' +
        'Call identify() from afterNextRender, or pass { immediate: true } to injectIdentify(), ' +
        'which already waits for the browser.',
    )
  }
}

export function failureHold(
  error: unknown,
  consecutive: number,
  now: number,
): { until: number; automaticUntil: number } {
  const failure = error as { retryAfterMs?: unknown; retryable?: unknown } | null
  const retryAfter =
    typeof failure?.retryAfterMs === 'number' && failure.retryAfterMs > 0
      ? failure.retryAfterMs
      : 0
  const backoff =
    failure?.retryable === true ? Math.min(60_000, 5_000 * 2 ** Math.max(0, consecutive - 1)) : 0
  return { until: now + retryAfter, automaticUntil: now + Math.max(retryAfter, backoff) }
}

export function createFingerly(options: FingerlyOptions): Fingerly {
  const requestId = signal<string | null>(null)
  const visitorId = signal<string | null>(null)
  const visitorIsNew = signal(false)
  const visitorConfidence = signal(0)
  const identifiable = signal(false)
  const duplicate = signal(false)
  const state = signal<string | null>(null)
  const suspectScore = signal<number | null>(null)
  const suspectLevel = signal<SuspectLevel | null>(null)
  const report = signal<SignalReport | null>(null)
  const error = signal<Error | null>(null)
  const isLoading = signal(false)
  const consent = signal<ConsentState>(options.consent ?? 'pending')

  const isReady = computed(() => report() !== null || error() !== null)
  const isSuspicious = computed(() => isSuspiciousLevel(suspectLevel()))

  let clientPromise: Promise<FingerlyClient> | undefined
  let loaded: FingerlyClient | undefined
  let current: Promise<IdentifyResult> | undefined
  let held: { error: Error; until: number; automaticUntil: number } | undefined
  let consecutiveFailures = 0

  const client = (): Promise<FingerlyClient> => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())
    clientPromise ??= Promise.resolve().then(() =>
      load({
        apiKey: options.apiKey,
        ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
        ...(options.endpoints === undefined ? {} : { endpoints: options.endpoints }),
        ...(options.fallbackToDefaultEndpoint === undefined
          ? {}
          : { fallbackToDefaultEndpoint: options.fallbackToDefaultEndpoint }),
        ...(options.incognitoDetection === undefined
          ? {}
          : { incognitoDetection: options.incognitoDetection }),
        consent: consent(),
      }).then((fingerly) => {
        if (fingerly.consent !== consent()) fingerly.setConsent(consent())
        fingerly.onConsentChange((next) => consent.set(next))
        loaded = fingerly
        return fingerly
      }),
    )
    return clientPromise
  }

  const setConsent: Fingerly['setConsent'] = (next) => {
    loaded?.setConsent(next)
    consent.set(next)
  }

  const identify: Fingerly['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())

    if (current && !identifyOptions.force) return current

    const now = Date.now()
    if (held && (now < held.until || (identifyOptions.automatic && now < held.automaticUntil))) {
      return Promise.reject(held.error)
    }

    isLoading.set(true)
    error.set(null)

    const incognitoDetection = identifyOptions.incognitoDetection ?? options.incognitoDetection

    const run = client()
      .then((fingerly) =>
        fingerly.identify({
          ...(identifyOptions.tag === undefined ? {} : { tag: identifyOptions.tag }),
          ...(incognitoDetection === undefined ? {} : { incognitoDetection }),
        }),
      )
      .then((result) => {
        requestId.set(result.requestId === '' ? null : result.requestId)
        visitorId.set(result.visitorId)
        visitorIsNew.set(result.visitorIsNew)
        visitorConfidence.set(result.visitorConfidence)
        identifiable.set(result.identifiable)
        duplicate.set(result.duplicate ?? false)
        state.set(result.state === '' ? null : result.state)
        suspectScore.set(result.suspectScore ?? null)
        suspectLevel.set(result.suspectLevel ?? null)
        report.set(result.report)
        held = undefined
        consecutiveFailures = 0
        return result
      })
      .catch((cause: unknown) => {
        const failure = cause instanceof Error ? cause : new Error(String(cause))
        error.set(failure)
        if (current === run) current = undefined
        consecutiveFailures += 1
        held = { error: failure, ...failureHold(failure, consecutiveFailures, Date.now()) }
        throw failure
      })
      .finally(() => {
        isLoading.set(false)
      })

    current = run
    return run
  }

  const refresh: Fingerly['refresh'] = (refreshOptions = {}) =>
    identify({ ...refreshOptions, force: true })

  return {
    requestId: requestId.asReadonly(),
    visitorId: visitorId.asReadonly(),
    visitorIsNew: visitorIsNew.asReadonly(),
    visitorConfidence: visitorConfidence.asReadonly(),
    identifiable: identifiable.asReadonly(),
    duplicate: duplicate.asReadonly(),
    state: state.asReadonly(),
    suspectScore: suspectScore.asReadonly(),
    suspectLevel: suspectLevel.asReadonly(),
    report: report.asReadonly(),
    error: error.asReadonly(),
    isLoading: isLoading.asReadonly(),
    isReady,
    isSuspicious,
    consent: consent.asReadonly(),
    setConsent,
    identify,
    refresh,
    client,
  }
}
