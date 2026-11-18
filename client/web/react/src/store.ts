/**
 * The shared state, and the single-pass v3 identification that fills it.
 */

import {
  load,
  type ConsentState,
  type Continuity,
  type FingerlyClient,
  type IdentifyResult,
  type IncognitoDetection,
  type SuspectLevel,
} from '@fingerly/web-js'

/**
 * What the binding hands back from `identify()`: the result without the full
 * signal report. The report is evidence for the server; keeping it in app
 * state for the page lifetime would let any component or debugging tool read
 * or log the whole fingerprint. Call `(await client()).collect()` to inspect a
 * report locally.
 */
export type IdentifyAnswer = Omit<IdentifyResult, 'report'>

/** A copy of `result` without its `report`, whether or not the client sent one. */
export function withoutReport<T extends object>(result: T): Omit<T, 'report'> {
  const copy = { ...result } as Record<string, unknown>
  delete copy.report
  return copy as Omit<T, 'report'>
}

/** Options for [[createFingerlyStore]] and for `<FingerlyProvider>`. */
export interface FingerlyReactOptions {
  /** The SDK key from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** API route version. Defaults to v1. */
  apiVersion?: string
  /** Ordered first-party ingestion endpoints. */
  endpoints?: string | readonly string[]
  /** Try the Fingerly API only after custom endpoints fail. */
  fallbackToDefaultEndpoint?: boolean
  /**
   * Controls whether opt-in extended incognito probes (`storage_durability`)
   * execute (`'standard'` default or `'extended'`).
   */
  incognitoDetection?: IncognitoDetection
  /**
   * Whether an identified private window is carried across the reports of
   * one tab: `'none'` (the default) keeps nothing in the browser, `'session'`
   * keeps one signed value in `sessionStorage` for the life of the tab.
   */
  continuity?: Continuity
  /**
   * Whether the visitor has agreed to be identified. Defaults to `pending`.
   */
  consent?: ConsentState
}

/** The result of the page's one identification, as components see it. */
export interface FingerlyState {
  requestId: string | null
  /**
   * `null` before an identification has completed; afterwards `result.visitorId`
   * (`""` when `identifiable === false` under Option B).
   */
  visitorId: string | null
  visitorIsNew: boolean
  visitorConfidence: number
  identifiable: boolean
  duplicate: boolean
  state: string | null
  suspectScore: number | null
  suspectLevel: SuspectLevel | null
  /** True once an identification has succeeded. */
  identified: boolean
  error: Error | null
  isLoading: boolean
  consent: ConsentState
}

const INITIAL: FingerlyState = Object.freeze({
  requestId: null,
  visitorId: null,
  visitorIsNew: false,
  visitorConfidence: 0,
  identifiable: false,
  duplicate: false,
  state: null,
  suspectScore: null,
  suspectLevel: null,
  identified: false,
  error: null,
  isLoading: false,
  consent: 'pending',
})

/** What `useFingerly()` returns, and what the provider puts in context. */
export interface FingerlyStore {
  readonly options: FingerlyReactOptions
  subscribe(listener: () => void): () => void
  getState(): FingerlyState
  getServerState(): FingerlyState
  client(): Promise<FingerlyClient>
  setConsent(state: ConsentState): void
  identify(options?: {
    tag?: string
    incognitoDetection?: IncognitoDetection
    force?: boolean
    automatic?: boolean
  }): Promise<IdentifyAnswer>
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
  const transient = failure?.retryable === true
  const backoff = transient ? Math.min(60_000, 5_000 * 2 ** Math.max(0, consecutive - 1)) : 0
  return { until: now + retryAfter, automaticUntil: now + Math.max(retryAfter, backoff) }
}

/** Thrown when the SDK is asked to collect somewhere there is no browser. */
export class FingerlyServerError extends Error {
  override readonly name = 'FingerlyServerError'
  constructor() {
    super(
      'Fingerly collects signals from a browser and cannot run during server-side rendering. ' +
        'Call identify() from an effect, or pass { immediate: true } to useIdentify(), ' +
        'which already waits for the client.',
    )
  }
}

export function createFingerlyStore(options: FingerlyReactOptions): FingerlyStore {
  const initial: FingerlyState =
    options.consent === undefined || options.consent === INITIAL.consent
      ? INITIAL
      : Object.freeze({ ...INITIAL, consent: options.consent })
  let state: FingerlyState = initial
  const listeners = new Set<() => void>()

  const setState = (patch: Partial<FingerlyState>): void => {
    state = { ...state, ...patch }
    for (const listener of [...listeners]) listener()
  }

  let clientPromise: Promise<FingerlyClient> | undefined
  let loaded: FingerlyClient | undefined
  let current: Promise<IdentifyAnswer> | undefined
  let held: { promise: Promise<IdentifyAnswer>; until: number; automaticUntil: number } | undefined
  let consecutiveFailures = 0

  const mirrorConsent = (consent: ConsentState): void => {
    if (state.consent !== consent) setState({ consent })
  }

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
        ...(options.continuity === undefined ? {} : { continuity: options.continuity }),
        consent: state.consent,
      }).then((fingerly) => {
        if (fingerly.consent !== state.consent) fingerly.setConsent(state.consent)
        fingerly.onConsentChange(mirrorConsent)
        loaded = fingerly
        return fingerly
      }),
    )
    return clientPromise
  }

  const setConsent: FingerlyStore['setConsent'] = (consent) => {
    loaded?.setConsent(consent)
    mirrorConsent(consent)
  }

  const identify: FingerlyStore['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())

    if (current && !identifyOptions.force) return current

    const now = Date.now()
    if (held && (now < held.until || (identifyOptions.automatic && now < held.automaticUntil))) {
      return held.promise
    }

    queueMicrotask(() => setState({ isLoading: true, error: null }))

    const incognitoDetection = identifyOptions.incognitoDetection ?? options.incognitoDetection

    const run = client()
      .then((fingerly) =>
        fingerly.identify({
          ...(identifyOptions.tag === undefined ? {} : { tag: identifyOptions.tag }),
          ...(incognitoDetection === undefined ? {} : { incognitoDetection }),
        }),
      )
      .then((full) => {
        const result = withoutReport(full)
        setState({
          requestId: result.requestId === '' ? null : result.requestId,
          visitorId: result.visitorId,
          visitorIsNew: result.visitorIsNew,
          visitorConfidence: result.visitorConfidence,
          identifiable: result.identifiable,
          duplicate: result.duplicate ?? false,
          state: result.state === '' ? null : result.state,
          suspectScore: result.suspectScore ?? null,
          suspectLevel: result.suspectLevel ?? null,
          identified: true,
        })
        held = undefined
        consecutiveFailures = 0
        return result
      })
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        setState({ error })
        if (current === run) current = undefined
        consecutiveFailures += 1
        const rejected = Promise.reject(error)
        rejected.catch(() => undefined)
        held = { promise: rejected, ...failureHold(error, consecutiveFailures, Date.now()) }
        throw error
      })
      .finally(() => {
        setState({ isLoading: false })
      })

    current = run
    return run
  }

  return {
    options,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getState: () => state,
    getServerState: () => initial,
    client,
    setConsent,
    identify,
  }
}
