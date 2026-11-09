/**
 * The shared state, in runes.
 *
 * A `.svelte.ts` module rather than a plain one, which is what lets `$state`
 * live outside a component: the file is compiled by the Svelte compiler in the
 * consuming app, so the fields below are reactive wherever they are read.
 * That is the whole reason this binding needs no store, no subscription and no
 * `$` prefix at the call site - a component reads `fingerly.verdicts` and
 * re-renders when it changes.
 *
 * One state per app, not one per component. Identification is a *page-level*
 * event: three components asking whether the visitor is suspicious should
 * produce one submission and one answer, not three. Per-component state would
 * bill the customer three times for one page load and hand the three
 * components three different `requestId`s for one visitor.
 */

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

/** Options for [[createFingerly]] and [[setupFingerly]]. */
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
   * collected or sent: `useIdentify({ immediate: true })` waits, and a manual
   * `identify()` fails with a `ConsentError` in `error`.
   */
  consent?: ConsentState
}

/** What a component reads. Every field is reactive; none of them is settable. */
export interface Fingerly {
  readonly requestId: string | null
  /**
   * Who the server decided this is. Null under `submit: false`, and null
   * before the first identification - never empty-string, so a template can
   * ask `fingerly.visitorId` without also asking whether it means anything.
   */
  readonly visitorId: string | null
  /** True when the server had never seen this visitor before. */
  readonly visitorIsNew: boolean
  /** How sure the server is of `visitorId`, 0-100. */
  readonly visitorConfidence: number
  /** False when the signals were too thin to identify anybody. */
  readonly identifiable: boolean
  /** True when this submission had already been answered. */
  readonly duplicate: boolean
  /** The server's disposition of the check. */
  readonly state: string | null
  /**
   * @deprecated Always `null`. A browser is no longer told why a check went
   * unscored; your backend reads `reason` on the server-side event read, by
   * `requestId`. Kept so code written against 0.1.0 still compiles.
   */
  readonly reason: string | null
  /**
   * The server's score, 0-100, or null when it did not score.
   *
   * Null and zero are different answers: null is "not scored", zero is
   * "scored, nothing found". Do not collapse them with `?? 0`.
   */
  readonly suspectScore: number | null
  /** The score as a band - `low`, `medium`, `high`. Null when unscored. */
  readonly suspectLevel: string | null
  /** What the server scored on. Empty when it found nothing. */
  readonly triggers: readonly IdentifyTrigger[]
  /** @deprecated Read `suspectLevel` and `triggers`. Holds nothing when no server answered. */
  readonly verdicts: Verdicts | null
  readonly report: SignalReport | null
  readonly error: Error | null
  readonly isLoading: boolean
  /** True once an identification has completed, successfully or not. */
  readonly isReady: boolean
  /**
   * True when the server scored this `medium` or `high` under the weights you
   * set: the "should I even look?" flag, and not a policy. `null` when no
   * server has answered (not identified yet, `submit: false`, or unscored),
   * which is not a clean result. Anything more nuanced reads `suspectLevel`
   * and `triggers` directly.
   */
  readonly isSuspicious: boolean | null
  /**
   * Whether the visitor has agreed to be identified, as last set here or on
   * the client. Automatic identification waits for `granted`.
   */
  readonly consent: ConsentState
  /**
   * Record the visitor's consent, as the consent tool reports it.
   *
   * Usable before the client exists - during SSR, or before anything has
   * identified - and forwarded to it once it does. Setting `granted` is what
   * starts any `useIdentify({ immediate: true })` that was waiting for it.
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
        'Call identify() from an $effect, or pass { immediate: true } to useIdentify(), ' +
        'which already waits for the client.',
    )
  }
}

/**
 * Build the state.
 *
 * Nothing is collected here. Creating it only makes the client reachable - a
 * factory that fingerprinted as it ran would collect during a server render
 * and take the choice of *when* away from the page that knows.
 */
/**
 * How long a failed identification holds off the next one.
 *
 * Without this a failure was forgotten at once, and every component mounting
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
  let requestId = $state<string | null>(null)
  let visitorId = $state<string | null>(null)
  let visitorIsNew = $state(false)
  let visitorConfidence = $state(0)
  let identifiable = $state(false)
  let duplicate = $state(false)
  let checkState = $state<string | null>(null)
  let suspectScore = $state<number | null>(null)
  let suspectLevel = $state<string | null>(null)
  let triggers = $state<readonly IdentifyTrigger[]>([])
  let verdicts = $state<Verdicts | null>(null)
  let report = $state<SignalReport | null>(null)
  let error = $state<Error | null>(null)
  let isLoading = $state(false)
  let consent = $state<ConsentState>(options.consent ?? 'pending')

  const isReady = $derived(report !== null || error !== null)
  const isSuspicious = $derived(isSuspiciousLevel(suspectLevel))

  let clientPromise: Promise<FingerlyClient> | undefined
  let loaded: FingerlyClient | undefined
  let current: Promise<IdentifyResult> | undefined
  let held: { error: Error; until: number; automaticUntil: number } | undefined
  let consecutiveFailures = 0

  const mirrorConsent = (next: ConsentState): void => {
    consent = next
  }

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
      consent,
    }).then((fingerly) => {
      // Caught up before anything can identify through it: setConsent() may
      // have been called while load() was settling.
      if (fingerly.consent !== consent) fingerly.setConsent(consent)
      // And followed from here on, so a consent tool holding the client itself
      // moves this state - and whatever is waiting on it - as well.
      fingerly.onConsentChange(mirrorConsent)
      loaded = fingerly
      return fingerly
    }))
    return clientPromise
  }

  const setConsent: Fingerly['setConsent'] = (next) => {
    // The client first, so it validates the value and has it before an effect
    // reacting to the state below asks it to identify.
    loaded?.setConsent(next)
    mirrorConsent(next)
  }

  const identify: Fingerly['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())

    // One promise for the page, in flight or already settled, which is what
    // makes `useIdentify({ immediate: true })` safe in as many components as
    // want it.
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

    isLoading = true
    error = null

    const run = client()
      .then((fingerly) =>
        fingerly.identify({
          ...(identifyOptions.tag === undefined ? {} : { tag: identifyOptions.tag }),
          ...(options.submit === undefined ? {} : { submit: options.submit }),
        }),
      )
      .then((result) => {
        requestId = result.requestId === '' ? null : result.requestId
        visitorId = result.visitorId === '' ? null : result.visitorId
        visitorIsNew = result.visitorIsNew
        visitorConfidence = result.visitorConfidence
        identifiable = result.identifiable
        duplicate = result.duplicate
        checkState = result.state === '' ? null : result.state
        suspectScore = result.suspectScore
        suspectLevel = result.suspectLevel
        triggers = result.triggers
        verdicts = verdictsOf(result)
        report = result.report
        held = undefined
        consecutiveFailures = 0
        return result
      })
      .catch((cause: unknown) => {
        const failure = cause instanceof Error ? cause : new Error(String(cause))
        error = failure
        consecutiveFailures += 1
        held = { error: failure, ...failureHold(failure, consecutiveFailures, Date.now()) }
        // Forgotten, so the next caller retries rather than being handed a
        // rejected promise forever.
        if (current === run) current = undefined
        // Rethrown as well as stored: a caller that awaited identify() should
        // be able to try/catch it, and a component that only reads `error`
        // should not have to.
        throw failure
      })
      .finally(() => {
        isLoading = false
      })

    current = run
    return run
  }

  const refresh: Fingerly['refresh'] = (refreshOptions = {}) =>
    identify({ ...refreshOptions, force: true })

  // Getters rather than fields: reading through one is what subscribes the
  // caller's template to the rune behind it. Returning the values directly
  // would hand out a snapshot taken at the moment this function ran.
  return {
    get requestId() {
      return requestId
    },
    get visitorId() {
      return visitorId
    },
    get visitorIsNew() {
      return visitorIsNew
    },
    get visitorConfidence() {
      return visitorConfidence
    },
    get identifiable() {
      return identifiable
    },
    get duplicate() {
      return duplicate
    },
    get state() {
      return checkState
    },
    get reason() {
      // Deprecated: the server no longer tells a browser. See the interface.
      return null
    },
    get suspectScore() {
      return suspectScore
    },
    get suspectLevel() {
      return suspectLevel
    },
    get triggers() {
      return triggers
    },
    get verdicts() {
      return verdicts
    },
    get report() {
      return report
    },
    get error() {
      return error
    },
    get isLoading() {
      return isLoading
    },
    get isReady() {
      return isReady
    },
    get isSuspicious() {
      return isSuspicious
    },
    get consent() {
      return consent
    },
    setConsent,
    identify,
    refresh,
    client,
  }
}
