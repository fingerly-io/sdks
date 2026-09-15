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
  load,
  type FingerlyClient,
  type IdentifyResult,
  type IdentifyTrigger,
  type SignalReport,
  type Verdicts,
} from '@fingerly/web-js'

/** Options for [[createFingerly]] and [[setupFingerly]]. */
export interface FingerlyOptions {
  /** The SDK key from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** Origin of the API. Defaults to production. */
  endpoint?: string
  endpoints?: string | readonly string[]
  fallbackToDefaultEndpoint?: boolean
  /**
   * Collect and score without submitting anything.
   *
   * For a page that wants the local verdicts and nothing else. Everything
   * the server decides comes back empty: no `requestId`, no `visitorId` and
   * no `suspectScore`. That is the honest answer rather than a gap - nothing
   * was sent, so nobody scored it, and a zero here would read as "scored,
   * found nothing".
   */
  submit?: boolean
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
  /** Why, when `state` needs explaining. */
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
  readonly verdicts: Verdicts | null
  readonly report: SignalReport | null
  readonly error: Error | null
  readonly isLoading: boolean
  /** True once an identification has completed, successfully or not. */
  readonly isReady: boolean
  /**
   * True when the verdicts contain anything worth acting on.
   *
   * Deliberately conservative: it requires `medium` confidence or better,
   * because a `low`-confidence verdict is one weak tell and blocking on it
   * would be blocking real users. Anything more nuanced should read `verdicts`
   * directly - this is the "should I even look?" flag, not a policy.
   */
  readonly isSuspicious: boolean
  /** Collect, score and submit. Reuses a completed run unless `force`. */
  identify(options?: { tag?: string; force?: boolean }): Promise<IdentifyResult>
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
export function createFingerly(options: FingerlyOptions): Fingerly {
  let requestId = $state<string | null>(null)
  let visitorId = $state<string | null>(null)
  let visitorIsNew = $state(false)
  let visitorConfidence = $state(0)
  let identifiable = $state(false)
  let duplicate = $state(false)
  let checkState = $state<string | null>(null)
  let reason = $state<string | null>(null)
  let suspectScore = $state<number | null>(null)
  let suspectLevel = $state<string | null>(null)
  let triggers = $state<readonly IdentifyTrigger[]>([])
  let verdicts = $state<Verdicts | null>(null)
  let report = $state<SignalReport | null>(null)
  let error = $state<Error | null>(null)
  let isLoading = $state(false)

  const isReady = $derived(report !== null || error !== null)
  const isSuspicious = $derived(
    verdicts === null
      ? false
      : Object.values(verdicts).some((verdict) => verdict.value && verdict.confidence !== 'low'),
  )

  let clientPromise: Promise<FingerlyClient> | undefined
  let current: Promise<IdentifyResult> | undefined

  const client = (): Promise<FingerlyClient> => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())
    // Built once and memoised. `load()` is cheap today but is the documented
    // place for future warm-up work, and warming up per component would undo
    // it.
    clientPromise ??= load({
      apiKey: options.apiKey,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      ...(options.endpoints === undefined ? {} : { endpoints: options.endpoints }),
      ...(options.fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint: options.fallbackToDefaultEndpoint }),
    })
    return clientPromise
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
        reason = result.reason === '' ? null : result.reason
        suspectScore = result.suspectScore
        suspectLevel = result.suspectLevel
        triggers = result.triggers
        verdicts = result.verdicts
        report = result.report
        return result
      })
      .catch((cause: unknown) => {
        error = cause instanceof Error ? cause : new Error(String(cause))
        // Forgotten, so the next caller retries rather than being handed a
        // rejected promise forever.
        if (current === run) current = undefined
        // Rethrown as well as stored: a caller that awaited identify() should
        // be able to try/catch it, and a component that only reads `error`
        // should not have to.
        throw error
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
      return reason
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
    identify,
    refresh,
    client,
  }
}
