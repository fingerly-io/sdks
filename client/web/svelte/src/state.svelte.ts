/**
 * The shared state, in Svelte 5 runes (`0.6.0`, single-pass `v: 3`).
 */

import {
  isSuspiciousLevel,
  load,
  type AgentDetection,
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

/** Options for [[createFingerly]] and [[setupFingerly]]. */
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
  /**
   * Whether an identified private window is carried across the reports of
   * one tab: `'none'` (the default) keeps nothing in the browser, `'session'`
   * keeps one signed value in `sessionStorage` for the life of the tab.
   */
  continuity?: Continuity
  /**
   * Observe how the page is operated, for recognising an assistant that
   * drives the visitor's own browser. Off by default; `'interaction'` turns it
   * on. Counts input events only once consent is `granted`.
   */
  agentDetection?: AgentDetection
  /** Whether the visitor has agreed to be identified. Defaults to `pending`. */
  consent?: ConsentState
}

/** What a component reads. Every field is reactive; none of them is settable. */
export interface Fingerly {
  readonly requestId: string | null
  /**
   * `null` before the first identification; afterwards `result.visitorId`
   * (`""` when `identifiable === false` under Option B).
   */
  readonly visitorId: string | null
  readonly visitorIsNew: boolean
  readonly visitorConfidence: number
  readonly identifiable: boolean
  readonly duplicate: boolean
  readonly state: string | null
  readonly suspectScore: number | null
  readonly suspectLevel: SuspectLevel | null
  /** True once an identification has succeeded. */
  readonly identified: boolean
  readonly error: Error | null
  readonly isLoading: boolean
  readonly isReady: boolean
  /**
   * True for `medium` or `high`, `null` when the level is absent. A UI hint
   * only: access decisions belong on your backend, which reads the event by
   * `requestId` with the secret key.
   */
  readonly isSuspicious: boolean | null
  readonly consent: ConsentState
  setConsent(state: ConsentState): void
  identify(options?: {
    tag?: string
    incognitoDetection?: IncognitoDetection
    force?: boolean
    automatic?: boolean
  }): Promise<IdentifyAnswer>
  refresh(options?: {
    tag?: string
    incognitoDetection?: IncognitoDetection
  }): Promise<IdentifyAnswer>
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
  let requestId = $state<string | null>(null)
  let visitorId = $state<string | null>(null)
  let visitorIsNew = $state(false)
  let visitorConfidence = $state(0)
  let identifiable = $state(false)
  let duplicate = $state(false)
  let checkState = $state<string | null>(null)
  let suspectScore = $state<number | null>(null)
  let suspectLevel = $state<SuspectLevel | null>(null)
  let identified = $state(false)
  let error = $state<Error | null>(null)
  let isLoading = $state(false)
  let consent = $state<ConsentState>(options.consent ?? 'pending')

  const isReady = $derived(identified || error !== null)
  const isSuspicious = $derived(isSuspiciousLevel(suspectLevel))

  let clientPromise: Promise<FingerlyClient> | undefined
  let loaded: FingerlyClient | undefined
  let current: Promise<IdentifyAnswer> | undefined
  let held: { error: Error; until: number; automaticUntil: number } | undefined
  let consecutiveFailures = 0

  const mirrorConsent = (next: ConsentState): void => {
    consent = next
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
        ...(options.agentDetection === undefined
          ? {}
          : { agentDetection: options.agentDetection }),
        consent,
      }).then((fingerly) => {
        if (fingerly.consent !== consent) fingerly.setConsent(consent)
        fingerly.onConsentChange(mirrorConsent)
        loaded = fingerly
        return fingerly
      }),
    )
    return clientPromise
  }

  // A page that opted into agent detection counts from the moment consent is
  // granted. The client is built lazily, and building it is what starts the
  // observer, so it is built then rather than at the first identify(), whose
  // report would otherwise cover nothing the visitor did before it.
  const observeFrom = (granted: ConsentState): void => {
    if (granted !== 'granted' || options.agentDetection !== 'interaction') return
    if (typeof window === 'undefined') return
    void client().catch(() => undefined)
  }

  const setConsent: Fingerly['setConsent'] = (next) => {
    loaded?.setConsent(next)
    mirrorConsent(next)
    observeFrom(next)
  }
  observeFrom(consent)

  const identify: Fingerly['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())

    if (current && !identifyOptions.force) return current

    const now = Date.now()
    if (held && (now < held.until || (identifyOptions.automatic && now < held.automaticUntil))) {
      return Promise.reject(held.error)
    }

    isLoading = true
    error = null

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
        requestId = result.requestId === '' ? null : result.requestId
        visitorId = result.visitorId
        visitorIsNew = result.visitorIsNew
        visitorConfidence = result.visitorConfidence
        identifiable = result.identifiable
        duplicate = result.duplicate ?? false
        checkState = result.state === '' ? null : result.state
        suspectScore = result.suspectScore ?? null
        suspectLevel = result.suspectLevel ?? null
        identified = true
        held = undefined
        consecutiveFailures = 0
        return result
      })
      .catch((cause: unknown) => {
        const failure = cause instanceof Error ? cause : new Error(String(cause))
        error = failure
        consecutiveFailures += 1
        held = { error: failure, ...failureHold(failure, consecutiveFailures, Date.now()) }
        if (current === run) current = undefined
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
    get suspectScore() {
      return suspectScore
    },
    get suspectLevel() {
      return suspectLevel
    },
    get identified() {
      return identified
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
