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
  type ConsentState,
  type IdentifyTrigger,
  load,
  type FingerlyClient,
  type IdentifyResult,
  type SignalReport,
  type Verdicts,
} from '@fingerly/web-js'

/** Options for [[createFingerlyStore]] and for `<FingerlyProvider>`. */
export interface FingerlyReactOptions {
  /** The SDK key from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** Origin of the API. Defaults to production. */
  /** API route version. Defaults to v1. */
  apiVersion?: string
  endpoint?: string
  /** Ordered first-party ingestion endpoints. */
  endpoints?: string | readonly string[]
  /** Try the Fingerly API only after custom endpoints fail. */
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
  /**
   * Whether the visitor has agreed to be identified. Defaults to `pending`.
   *
   * Leave it `pending` while identification waits on a consent banner, then
   * call [[FingerlyStore.setConsent]] when it is answered, or pass `granted`
   * once you have consent (or another lawful basis). Until then nothing is
   * collected or sent: `useIdentify({ immediate: true })` waits, and a manual
   * `identify()` fails with a `ConsentError` in `error`.
   */
  consent?: ConsentState
}

/** The result of the page's one identification, as components see it. */
export interface FingerlyState {
  requestId: string | null

  /**
   * The server's answer, in the same round trip as the submission.
   *
   * Null before an identification has completed, and null under `submit: false`
   * where nothing was sent. `visitorId` is otherwise always a value: a report
   * too thin to match anyone still gets an identifier, minted rather than
   * matched.
   */
  visitorId: string | null
  visitorIsNew: boolean
  /** 100 exact, 85-99 recognised through drift, 0 minted. */
  visitorConfidence: number
  identifiable: boolean
  /** This submission was answered before; the fields above are empty. */
  duplicate: boolean
  state: string | null
  reason: string | null
  /** Null when not scored, which is a different answer from zero. */
  suspectScore: number | null
  suspectLevel: string | null
  triggers: IdentifyTrigger[]
  verdicts: Verdicts | null
  report: SignalReport | null
  error: Error | null
  isLoading: boolean
  /**
   * Whether the visitor has agreed to be identified, as last set through the
   * store or the client. Automatic identification waits for `granted`.
   */
  consent: ConsentState
}

/**
 * The state before anything has been collected.
 *
 * One frozen object, shared by every store that does not configure `consent`
 * and handed back unchanged as the server snapshot. `useSyncExternalStore` compares snapshots by identity, so a
 * `getState()` that built a fresh object per call would re-render forever -
 * the loop React reports as "The result of getSnapshot should be cached".
 */
const INITIAL: FingerlyState = Object.freeze({
  requestId: null,
  visitorId: null,
  visitorIsNew: false,
  visitorConfidence: 0,
  identifiable: false,
  duplicate: false,
  state: null,
  reason: null,
  suspectScore: null,
  suspectLevel: null,
  // Frozen and shared, like the rest of INITIAL: an empty array allocated per
  // render would make every consumer re-render on every state read.
  triggers: [],
  verdicts: null,
  report: null,
  error: null,
  isLoading: false,
  consent: 'pending',
})

/** What `useFingerly()` returns, and what the provider puts in context. */
export interface FingerlyStore {
  readonly options: FingerlyReactOptions
  /** Register for state changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** The current state. Stable by identity until something changes. */
  getState(): FingerlyState
  /** The state a server render sees: the initial one, always. */
  getServerState(): FingerlyState
  /** The underlying client, built on first use. */
  client(): Promise<FingerlyClient>
  /**
   * Record the visitor's consent, as the consent tool reports it.
   *
   * Usable before the client exists - on the server, or before anything has
   * identified - and forwarded to it once it does. Setting `granted` is what
   * starts any `useIdentify({ immediate: true })` that was waiting for it.
   * The client's own `setConsent()` does the same.
   */
  setConsent(state: ConsentState): void
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

/**
 * Build a store.
 *
 * Nothing is collected here. Creating the store only makes the client
 * reachable - a provider that fingerprinted as it mounted would take the
 * choice of *when* away from the page that knows, and would do it during a
 * render rather than after one.
 */
export function createFingerlyStore(options: FingerlyReactOptions): FingerlyStore {
  // The configured consent is part of the initial state, and so of the server
  // snapshot too: a component rendering its banner from `consent` must render
  // the same thing on both sides of hydration.
  const initial: FingerlyState =
    options.consent === undefined || options.consent === INITIAL.consent
      ? INITIAL
      : Object.freeze({ ...INITIAL, consent: options.consent })
  let state: FingerlyState = initial
  const listeners = new Set<() => void>()

  const setState = (patch: Partial<FingerlyState>): void => {
    state = { ...state, ...patch }
    // A plain loop over a copy: a listener that unsubscribes as it runs - a
    // component unmounting in response to the verdict - must not perturb the
    // set the loop is walking.
    for (const listener of [...listeners]) listener()
  }

  let clientPromise: Promise<FingerlyClient> | undefined
  let loaded: FingerlyClient | undefined
  let current: Promise<IdentifyResult> | undefined

  const mirrorConsent = (consent: ConsentState): void => {
    if (state.consent !== consent) setState({ consent })
  }

  const client = (): Promise<FingerlyClient> => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())
    // Built once and memoised. `load()` is cheap today but is the documented
    // place for future warm-up work, and warming up per component would undo
    // it.
    // Through a promise even though load() returns one: a synchronous throw
    // here would escape every caller's .catch and take the React root down.
    clientPromise ??= Promise.resolve().then(() => load({
      apiKey: options.apiKey,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
      ...(options.endpoints === undefined ? {} : { endpoints: options.endpoints }),
      ...(options.fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint: options.fallbackToDefaultEndpoint }),
      consent: state.consent,
    }).then((fingerly) => {
      // Caught up before anything can identify through it: setConsent() may
      // have been called while load() was settling.
      if (fingerly.consent !== state.consent) fingerly.setConsent(state.consent)
      // And followed from here on, so a consent tool holding the client itself
      // moves this state - and whatever is waiting on it - as well.
      fingerly.onConsentChange(mirrorConsent)
      loaded = fingerly
      return fingerly
    }))
    return clientPromise
  }

  const setConsent: FingerlyStore['setConsent'] = (consent) => {
    // The client first, so it validates the value and has it before any
    // component reacting to the state below asks it to identify.
    loaded?.setConsent(consent)
    mirrorConsent(consent)
  }

  const identify: FingerlyStore['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())

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
      .then((fingerly) =>
        fingerly.identify({
          ...(identifyOptions.tag === undefined ? {} : { tag: identifyOptions.tag }),
          ...(options.submit === undefined ? {} : { submit: options.submit }),
        }),
      )
      .then((result) => {
        setState({
          requestId: result.requestId === '' ? null : result.requestId,
          visitorId: result.visitorId === '' ? null : result.visitorId,
          visitorIsNew: result.visitorIsNew,
          visitorConfidence: result.visitorConfidence,
          identifiable: result.identifiable,
          duplicate: result.duplicate,
          state: result.state === '' ? null : result.state,
          reason: result.reason === '' ? null : result.reason,
          suspectScore: result.suspectScore,
          suspectLevel: result.suspectLevel,
          triggers: result.triggers,
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
    getServerState: () => initial,
    client,
    setConsent,
    identify,
  }
}
