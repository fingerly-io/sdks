/**
 * The shared state, in signals.
 *
 * Angular's own reactive primitive rather than an RxJS subject: a template
 * reads `fingerly.isSuspicious()` and re-renders, with no subscription to manage
 * and nothing to unsubscribe from when the component goes away. It also works
 * in a zoneless app, which Angular now defaults to.
 *
 * One state per injector, not one per component. Identification is a
 * *page-level* event: three components asking whether the visitor is
 * suspicious should produce one submission and one answer, not three.
 * Per-component state would bill the customer three times for one page load
 * and hand the three components three different `requestId`s for one visitor.
 */

import { computed, signal, type Signal } from '@angular/core'
import {
  isSuspiciousLevel,
  load,
  type ConsentState,
  type FingerlyClient,
  type IdentifyResult,
  type IdentifyTrigger,
  type SignalReport,
  type Verdicts,
  verdictsOf,
} from '@fingerly/web-js'

/** Options for [[provideFingerly]]. */
export interface FingerlyOptions {
  /** The SDK key from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** Origin of the API. Defaults to production. */
  /** API route version. Defaults to v1. */
  apiVersion?: string
  endpoint?: string
  endpoints?: string | readonly string[]
  fallbackToDefaultEndpoint?: boolean
  /**
   * Collect without submitting anything.
   *
   * Everything the server decides comes back empty: no `requestId`, no
   * `visitorId`, no `suspectScore`, and `verdicts` holding nothing rather
   * than all clear. That is the honest answer rather than a gap - nothing was
   * sent, so nobody scored it, and this SDK decides nothing on its own.
   */
  submit?: boolean
  /**
   * Whether the visitor has agreed to be identified. Defaults to `pending`.
   *
   * Leave it `pending` while identification waits on a consent banner, then
   * call [[Fingerly.setConsent]] when it is answered, or pass `granted`
   * once you have consent (or another lawful basis). Until then nothing is
   * collected or sent: `injectIdentify({ immediate: true })` waits, and a
   * manual `identify()` fails with a `ConsentError` in `error`.
   */
  consent?: ConsentState
}

/** What a component injects. Every field is a signal; none of them is writable. */
export interface Fingerly {
  readonly requestId: Signal<string | null>
  /**
   * Who the server decided this is. Null under `submit: false`, and null
   * before the first identification - never empty-string, so a template can
   * ask `visitorId()` without also asking whether it is meaningful.
   */
  readonly visitorId: Signal<string | null>
  /** True when the server had never seen this visitor before. */
  readonly visitorIsNew: Signal<boolean>
  /** How sure the server is of `visitorId`, 0-100. */
  readonly visitorConfidence: Signal<number>
  /** False when the signals were too thin to identify anybody. */
  readonly identifiable: Signal<boolean>
  /** True when this submission had already been answered. */
  readonly duplicate: Signal<boolean>
  /** The server's disposition of the check. */
  readonly state: Signal<string | null>
  /**
   * @deprecated Always `null`. A browser is no longer told why a check went
   * unscored; your backend reads `reason` on the server-side event read, by
   * `requestId`. Kept so code written against 0.1.0 still compiles.
   */
  readonly reason: Signal<string | null>
  /**
   * The server's score, 0-100, or null when it did not score.
   *
   * Null and zero are different answers: null is "not scored", zero is
   * "scored, nothing found". Do not collapse them with `?? 0`.
   */
  readonly suspectScore: Signal<number | null>
  /** The score as a band - `low`, `medium`, `high`. Null when unscored. */
  readonly suspectLevel: Signal<string | null>
  /** What the server scored on. Empty when it found nothing. */
  readonly triggers: Signal<readonly IdentifyTrigger[]>
  /** @deprecated Read `suspectLevel` and `triggers`. Holds nothing when no server answered. */
  readonly verdicts: Signal<Verdicts | null>
  readonly report: Signal<SignalReport | null>
  readonly error: Signal<Error | null>
  readonly isLoading: Signal<boolean>
  /** True once an identification has completed, successfully or not. */
  readonly isReady: Signal<boolean>
  /**
   * True when the server scored this `medium` or `high` under the weights you
   * set: the "should I even look?" flag, and not a policy. `null` when no
   * server has answered (not identified yet, `submit: false`, or unscored),
   * which is not a clean result. Anything more nuanced reads `suspectLevel`
   * and `triggers` directly.
   */
  readonly isSuspicious: Signal<boolean | null>
  /**
   * Whether the visitor has agreed to be identified, as last set here or on
   * the client. Automatic identification waits for `granted`.
   */
  readonly consent: Signal<ConsentState>
  /**
   * Record the visitor's consent, as the consent tool reports it.
   *
   * Usable before the client exists - during SSR, or before anything has
   * identified - and forwarded to it once it does. Setting `granted` is what
   * starts any `injectIdentify({ immediate: true })` that was waiting for it.
   * The client's own `setConsent()` does the same.
   */
  setConsent(state: ConsentState): void
  /** Collect, score and submit. Reuses a completed run unless `force`. */
  identify(options?: { tag?: string; force?: boolean; automatic?: boolean }): Promise<IdentifyResult>
  /** Identify again from scratch, ignoring any previous result. */
  refresh(options?: { tag?: string }): Promise<IdentifyResult>
  /** The underlying client, built on first use. */
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

/**
 * Build the state.
 *
 * Nothing is collected here. Creating it only makes the client reachable - a
 * factory that fingerprinted as the injector built it would collect during
 * every server render, and would take the choice of *when* away from the
 * component that knows.
 */
/**
 * How long a failed identification holds off the next one.
 *
 * Without this a failure was forgotten at once, and every component created
 * with `immediate` started another identification - three requests per route
 * change while the API was answering 429. A `Retry-After` the server sent
 * holds every call, forced or not, until it passes. A transient failure
 * without one (a 5xx, a network error) holds automatic calls only, for 5 s
 * doubling per consecutive failure up to a minute; a click still tries at
 * once. Anything else holds nothing.
 */
export function failureHold(error: unknown, consecutive: number, now: number): { until: number; automaticUntil: number } {
  const failure = error as { retryAfterMs?: unknown; retryable?: unknown } | null
  const retryAfter = typeof failure?.retryAfterMs === 'number' && failure.retryAfterMs > 0 ? failure.retryAfterMs : 0
  const backoff = failure?.retryable === true ? Math.min(60_000, 5_000 * 2 ** Math.max(0, consecutive - 1)) : 0
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
  const reason = signal<string | null>(null)
  const suspectScore = signal<number | null>(null)
  const suspectLevel = signal<string | null>(null)
  const triggers = signal<readonly IdentifyTrigger[]>([])
  const verdicts = signal<Verdicts | null>(null)
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
    // Built once and memoised. `load()` is cheap today but is the documented
    // place for future warm-up work, and warming up per component would undo
    // it.
    // Through a promise even though load() returns one: a synchronous throw
    // here would escape every caller's .catch and leave isLoading stuck.
    clientPromise ??= Promise.resolve().then(() => load({
      apiKey: options.apiKey,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
      ...(options.endpoints === undefined ? {} : { endpoints: options.endpoints }),
      ...(options.fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint: options.fallbackToDefaultEndpoint }),
      consent: consent(),
    }).then((fingerly) => {
      // Caught up before anything can identify through it: setConsent() may
      // have been called while load() was settling.
      if (fingerly.consent !== consent()) fingerly.setConsent(consent())
      // And followed from here on, so a consent tool holding the client itself
      // moves this state - and whatever is waiting on it - as well.
      fingerly.onConsentChange((next) => consent.set(next))
      loaded = fingerly
      return fingerly
    }))
    return clientPromise
  }

  const setConsent: Fingerly['setConsent'] = (next) => {
    // The client first, so it validates the value and has it before an effect
    // reacting to the signal below asks it to identify.
    loaded?.setConsent(next)
    consent.set(next)
  }

  const identify: Fingerly['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())

    // One promise for the page, in flight or already settled, which is what
    // makes `injectIdentify({ immediate: true })` safe in as many components
    // as want it.
    //
    // Memoising the promise rather than the report also settles a case the Vue
    // binding had to learn: under `submit: false` there is no requestId, so a
    // cache keyed on one never engages and every component re-collects the
    // whole fingerprint. A promise has an identity either way.
    if (current && !identifyOptions.force) return current

    // Holding off after a failure; see failureHold.
    const now = Date.now()
    if (held && (now < held.until || (identifyOptions.automatic && now < held.automaticUntil))) {
      return Promise.reject(held.error)
    }

    isLoading.set(true)
    error.set(null)

    const run = client()
      .then((fingerly) =>
        fingerly.identify({
          ...(identifyOptions.tag === undefined ? {} : { tag: identifyOptions.tag }),
          ...(options.submit === undefined ? {} : { submit: options.submit }),
        }),
      )
      .then((result) => {
        requestId.set(result.requestId === '' ? null : result.requestId)
        visitorId.set(result.visitorId === '' ? null : result.visitorId)
        visitorIsNew.set(result.visitorIsNew)
        visitorConfidence.set(result.visitorConfidence)
        identifiable.set(result.identifiable)
        duplicate.set(result.duplicate)
        state.set(result.state === '' ? null : result.state)
        suspectScore.set(result.suspectScore)
        suspectLevel.set(result.suspectLevel)
        triggers.set(result.triggers)
        // Copied without reading the deprecated field, so a page that never
        // looks at verdicts is not warned about them.
        verdicts.set(verdictsOf(result))
        report.set(result.report)
        held = undefined
        consecutiveFailures = 0
        return result
      })
      .catch((cause: unknown) => {
        const failure = cause instanceof Error ? cause : new Error(String(cause))
        error.set(failure)
        // Forgotten, so the next caller retries rather than being handed a
        // rejected promise forever.
        if (current === run) current = undefined
        consecutiveFailures += 1
        held = { error: failure, ...failureHold(failure, consecutiveFailures, Date.now()) }
        // Rethrown as well as stored: a caller that awaited identify() should
        // be able to try/catch it, and a template that only reads `error`
        // should not have to.
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

  // The writable signals are kept in this closure and only their read-only
  // views leave it. The state is shared, so a component that could `set()` it
  // would be changing what every other component sees.
  return {
    requestId: requestId.asReadonly(),
    visitorId: visitorId.asReadonly(),
    visitorIsNew: visitorIsNew.asReadonly(),
    visitorConfidence: visitorConfidence.asReadonly(),
    identifiable: identifiable.asReadonly(),
    duplicate: duplicate.asReadonly(),
    state: state.asReadonly(),
    reason: reason.asReadonly(),
    suspectScore: suspectScore.asReadonly(),
    suspectLevel: suspectLevel.asReadonly(),
    triggers: triggers.asReadonly(),
    verdicts: verdicts.asReadonly(),
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
