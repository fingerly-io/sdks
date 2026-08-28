/**
 * The shared state, in runes.
 *
 * A `.svelte.ts` module rather than a plain one, which is what lets `$state`
 * live outside a component: the file is compiled by the Svelte compiler in the
 * consuming app, so the fields below are reactive wherever they are read.
 * That is the whole reason this binding needs no store, no subscription and no
 * `$` prefix at the call site - a component reads `badele.verdicts` and
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
  type BadeleClient,
  type IdentifyResult,
  type SignalReport,
  type Verdicts,
} from '@badele/web-js'

/** Options for [[createBadele]] and [[setupBadele]]. */
export interface BadeleOptions {
  /** The SDK key from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** Origin of the API. Defaults to production. */
  endpoint?: string
  /**
   * Collect and score without submitting anything.
   *
   * For a page that wants the local verdicts and nothing else. `requestId`
   * stays null, which is the honest answer: nothing was sent, so there is
   * nothing to fetch later.
   */
  submit?: boolean
}

/** What a component reads. Every field is reactive; none of them is settable. */
export interface Badele {
  readonly requestId: string | null
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
  client(): Promise<BadeleClient>
}

/** Thrown when the SDK is asked to collect somewhere there is no browser. */
export class BadeleServerError extends Error {
  override readonly name = 'BadeleServerError'
  constructor() {
    super(
      'Badele collects signals from a browser and cannot run during server-side rendering. ' +
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
export function createBadele(options: BadeleOptions): Badele {
  let requestId = $state<string | null>(null)
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

  let clientPromise: Promise<BadeleClient> | undefined
  let current: Promise<IdentifyResult> | undefined

  const client = (): Promise<BadeleClient> => {
    if (typeof window === 'undefined') return Promise.reject(new BadeleServerError())
    // Built once and memoised. `load()` is cheap today but is the documented
    // place for future warm-up work, and warming up per component would undo
    // it.
    clientPromise ??= load({
      apiKey: options.apiKey,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    })
    return clientPromise
  }

  const identify: Badele['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new BadeleServerError())

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
      .then((badele) =>
        badele.identify({
          ...(identifyOptions.tag === undefined ? {} : { tag: identifyOptions.tag }),
          ...(options.submit === undefined ? {} : { submit: options.submit }),
        }),
      )
      .then((result) => {
        requestId = result.requestId === '' ? null : result.requestId
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

  const refresh: Badele['refresh'] = (refreshOptions = {}) =>
    identify({ ...refreshOptions, force: true })

  // Getters rather than fields: reading through one is what subscribes the
  // caller's template to the rune behind it. Returning the values directly
  // would hand out a snapshot taken at the moment this function ran.
  return {
    get requestId() {
      return requestId
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
