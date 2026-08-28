/**
 * The shared state, and the identification that fills it.
 *
 * Deliberately free of React. A `subscribe`/`getState` pair is precisely what
 * `useSyncExternalStore` is for - it is the API React added so that state
 * living outside the tree can be read from inside it without tearing under
 * concurrent rendering - and keeping the logic here means the sharing rule is
 * one implementation rather than one per hook.
 *
 * That rule is the important decision in this file. Identification is a
 * *page-level* event: three components asking whether the visitor is
 * suspicious should produce one submission and one answer, not three.
 * Per-component state would bill the customer three times for one page load
 * and hand the three components three different `requestId`s for one visitor.
 */

import {
  load,
  type BadeleClient,
  type IdentifyResult,
  type SignalReport,
  type Verdicts,
} from '@badele/web-js'

/** Options for [[createBadeleStore]] and for `<BadeleProvider>`. */
export interface BadeleReactOptions {
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

/** The result of the page's one identification, as components see it. */
export interface BadeleState {
  requestId: string | null
  verdicts: Verdicts | null
  report: SignalReport | null
  error: Error | null
  isLoading: boolean
}

/**
 * The state before anything has been collected.
 *
 * One frozen object, shared by every store and handed back unchanged as the
 * server snapshot. `useSyncExternalStore` compares snapshots by identity, so a
 * `getState()` that built a fresh object per call would re-render forever -
 * the loop React reports as "The result of getSnapshot should be cached".
 */
const INITIAL: BadeleState = Object.freeze({
  requestId: null,
  verdicts: null,
  report: null,
  error: null,
  isLoading: false,
})

/** What `useBadele()` returns, and what the provider puts in context. */
export interface BadeleStore {
  readonly options: BadeleReactOptions
  /** Register for state changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** The current state. Stable by identity until something changes. */
  getState(): BadeleState
  /** The state a server render sees: the initial one, always. */
  getServerState(): BadeleState
  /** The underlying client, built on first use. */
  client(): Promise<BadeleClient>
  /**
   * Identify, at most once unless asked otherwise.
   *
   * The promise is memoised, not just the result: every caller gets the *same*
   * promise object back until someone forces a fresh run. That is what makes
   * the result safe to hand to React's `use()`, which identifies a pending
   * value by the promise itself - a new promise per render would suspend
   * forever.
   *
   * `force` starts a fresh identification, which is what a long-lived SPA
   * wants before a second checkout.
   */
  identify(options?: { tag?: string; force?: boolean }): Promise<IdentifyResult>
}

/** Thrown when the SDK is asked to collect somewhere there is no browser. */
export class BadeleServerError extends Error {
  override readonly name = 'BadeleServerError'
  constructor() {
    super(
      'Badele collects signals from a browser and cannot run during server-side rendering. ' +
        'Call identify() from an effect, or pass { immediate: true } to useIdentify(), ' +
        'which already waits for the client.',
    )
  }
}

/**
 * Build a store.
 *
 * Nothing is collected here. Creating the store only makes the client
 * reachable - a provider that fingerprinted as it mounted would take the
 * choice of *when* away from the page that knows, and would do it during a
 * render rather than after one.
 */
export function createBadeleStore(options: BadeleReactOptions): BadeleStore {
  let state: BadeleState = INITIAL
  const listeners = new Set<() => void>()

  const setState = (patch: Partial<BadeleState>): void => {
    state = { ...state, ...patch }
    // A plain loop over a copy: a listener that unsubscribes as it runs - a
    // component unmounting in response to the verdict - must not perturb the
    // set the loop is walking.
    for (const listener of [...listeners]) listener()
  }

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

  const identify: BadeleStore['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new BadeleServerError())

    // One promise for the page, in flight or already settled. This is what
    // makes `useIdentify({ immediate: true })` safe in as many components as
    // want it, what makes StrictMode's deliberate double mount in development
    // cost one identification rather than two, and what lets a component
    // suspend on the result.
    //
    // Memoising the promise rather than the report also settles a case the
    // Vue binding had to learn: under `submit: false` there is no requestId,
    // so any cache keyed on one never engages and every component re-collects
    // the whole fingerprint. A promise has an identity either way.
    if (current && !identifyOptions.force) return current

    // Deferred by a microtask, and this one is not cosmetic. A component using
    // `suspend` calls identify() *during render*, and a store that notified
    // its subscribers there would be updating other components mid-render -
    // React's "cannot update a component while rendering a different
    // component". Every other transition in this function already happens in a
    // promise callback, so this is the only one that can land in a render.
    queueMicrotask(() => setState({ isLoading: true, error: null }))

    const run = client()
      .then((badele) =>
        badele.identify({
          ...(identifyOptions.tag === undefined ? {} : { tag: identifyOptions.tag }),
          ...(options.submit === undefined ? {} : { submit: options.submit }),
        }),
      )
      .then((result) => {
        setState({
          requestId: result.requestId === '' ? null : result.requestId,
          verdicts: result.verdicts,
          report: result.report,
        })
        return result
      })
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        setState({ error })
        // Forgotten, so the next caller retries rather than being handed a
        // rejected promise forever. A failed identification is worth another
        // attempt; a suspended component would otherwise never get one.
        if (current === run) current = undefined
        // Rethrown as well as stored: a caller that awaited identify() should
        // be able to try/catch it, and a component that only reads `error`
        // should not have to.
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
    getServerState: () => INITIAL,
    client,
    identify,
  }
}
