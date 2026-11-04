/**
 * The Vue plugin, and the state every composable shares.
 *
 * The state lives on the app rather than in each `useIdentify()` call, and that
 * is the important decision in this file. Identification is a *page-level*
 * event: three components asking whether the visitor is suspicious should
 * produce one submission and one answer, not three. Per-call state would bill
 * the customer three times for one page load and give the three components
 * three different `requestId`s for the same visitor.
 */

import {
  load,
  type ConsentState,
  type FingerlyClient,
  type IdentifyResult,
  type IdentifyTrigger,
  type SignalReport,
  type Verdicts,
} from '@fingerly/web-js'
import {
  readonly,
  shallowReadonly,
  ref,
  shallowRef,
  type App,
  type DeepReadonly,
  type InjectionKey,
  type Plugin,
  type Ref,
  type ShallowRef,
} from 'vue'

/** Options for [[createFingerly]]. Everything `load()` takes, plus Vue's own. */
export interface FingerlyVueOptions {
  /** The SDK key from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** Origin of the API. Defaults to production. */
  /** API route version. Defaults to v1. */
  apiVersion?: string
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
  /**
   * Whether the visitor has agreed to be identified. Defaults to `pending`.
   *
   * Leave it `pending` while identification waits on a consent banner, then
   * call [[FingerlyContext.setConsent]] when it is answered, or pass `granted`
   * once you have consent (or another lawful basis). Until then nothing is
   * collected or sent: `useIdentify({ immediate: true })` waits, and a manual
   * `identify()` fails with a `ConsentError` in `error`.
   */
  consent?: ConsentState
}

/** The shared, reactive result of the app's one identification. */
export interface FingerlyState {
  requestId: ShallowRef<string | null>
  visitorId: ShallowRef<string | null>
  visitorIsNew: ShallowRef<boolean>
  visitorConfidence: ShallowRef<number>
  identifiable: ShallowRef<boolean>
  duplicate: ShallowRef<boolean>
  state: ShallowRef<string | null>
  reason: ShallowRef<string | null>
  suspectScore: ShallowRef<number | null>
  suspectLevel: ShallowRef<string | null>
  triggers: ShallowRef<IdentifyTrigger[]>
  verdicts: ShallowRef<Verdicts | null>
  report: ShallowRef<SignalReport | null>
  error: ShallowRef<Error | null>
  isLoading: Ref<boolean>
  /** As last set through the plugin or the client. Automatic identification waits for `granted`. */
  consent: ShallowRef<ConsentState>
}

/** What the plugin provides. Reach it with `useFingerly()`. */
export interface FingerlyContext {
  readonly options: FingerlyVueOptions
  readonly state: FingerlyState
  /** The underlying client, built on first use. */
  client(): Promise<FingerlyClient>
  /**
   * Record the visitor's consent, as the consent tool reports it.
   *
   * Usable before the client exists - during SSR, or before anything has
   * identified - and forwarded to it once it does. Setting `granted` is what
   * starts any `useIdentify({ immediate: true })` that was waiting for it.
   * The client's own `setConsent()` does the same.
   */
  setConsent(state: ConsentState): void
  /**
   * Identify, at most once unless asked otherwise.
   *
   * Concurrent callers share the in-flight promise; later callers get the
   * result already in `state` without a second submission. `force` starts a
   * fresh one, which is what a long-lived SPA wants before a second checkout.
   */
  identify(options?: { tag?: string; force?: boolean; automatic?: boolean }): Promise<IdentifyResult>
}

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

/**
 * The injection key.
 *
 * Exported so an advanced caller can `inject()` it directly, and typed with
 * `InjectionKey` so that doing so is type-safe rather than `unknown`.
 */
export const fingerlyKey: InjectionKey<FingerlyContext> = Symbol('fingerly')

/** Thrown when the SDK is asked to collect somewhere there is no browser. */
export class FingerlyServerError extends Error {
  override readonly name = 'FingerlyServerError'
  constructor() {
    super(
      'Fingerly collects signals from a browser and cannot run during server-side rendering. ' +
        'Call identify() from onMounted, or pass { immediate: true } to useIdentify(), ' +
        'which already waits for the client.',
    )
  }
}

function createState(consent: ConsentState): FingerlyState {
  return {
    // shallowRef throughout: a SignalReport is a large frozen-in-practice
    // object that is replaced wholesale, never edited field by field. Deep
    // reactivity would walk every source on every assignment and buy nothing.
    requestId: shallowRef<string | null>(null),
    visitorId: shallowRef<string | null>(null),
    visitorIsNew: shallowRef(false),
    visitorConfidence: shallowRef(0),
    identifiable: shallowRef(false),
    duplicate: shallowRef(false),
    state: shallowRef<string | null>(null),
    reason: shallowRef<string | null>(null),
    suspectScore: shallowRef<number | null>(null),
    suspectLevel: shallowRef<string | null>(null),
    triggers: shallowRef<IdentifyTrigger[]>([]),
    verdicts: shallowRef<Verdicts | null>(null),
    report: shallowRef<SignalReport | null>(null),
    error: shallowRef<Error | null>(null),
    isLoading: ref(false),
    consent: shallowRef(consent),
  }
}

/**
 * Build the plugin.
 *
 * ```ts
 * app.use(createFingerly({ apiKey: 'fly_pk_production_…' }))
 * ```
 *
 * Nothing is collected here. Installing the plugin only makes the client
 * available - a plugin that fingerprinted on install would run before the app
 * has rendered and during SSR, and would take the choice of *when* away from
 * the page that knows.
 */
export function createFingerly(options: FingerlyVueOptions): Plugin {
  const state = createState(options.consent ?? 'pending')

  let clientPromise: Promise<FingerlyClient> | undefined
  let loaded: FingerlyClient | undefined
  let inFlight: Promise<IdentifyResult> | undefined
  let completed: IdentifyResult | undefined
  let held: { error: Error; until: number; automaticUntil: number } | undefined
  let consecutiveFailures = 0

  const mirrorConsent = (consent: ConsentState): void => {
    state.consent.value = consent
  }

  const client = (): Promise<FingerlyClient> => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())
    // Built once and memoised. `load()` is cheap today but is the documented
    // place for future warm-up work, and warming up per component would undo it.
    // Through a promise even though load() returns one: a synchronous throw
    // here would escape every caller's .catch and fail the app's mount.
    clientPromise ??= Promise.resolve().then(() => load({
      apiKey: options.apiKey,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
      ...(options.endpoints === undefined ? {} : { endpoints: options.endpoints }),
      ...(options.fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint: options.fallbackToDefaultEndpoint }),
      consent: state.consent.value,
    }).then((fingerly) => {
      // Caught up before anything can identify through it: setConsent() may
      // have been called while load() was settling.
      if (fingerly.consent !== state.consent.value) fingerly.setConsent(state.consent.value)
      // And followed from here on, so a consent tool holding the client itself
      // moves this state - and whatever is waiting on it - as well.
      fingerly.onConsentChange(mirrorConsent)
      loaded = fingerly
      return fingerly
    }))
    return clientPromise
  }

  const setConsent: FingerlyContext['setConsent'] = (consent) => {
    // The client first, so it validates the value and has it before a watcher
    // reacting to the state below asks it to identify.
    loaded?.setConsent(consent)
    mirrorConsent(consent)
  }

  const identify: FingerlyContext['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())

    if (inFlight && !identifyOptions.force) return inFlight

    // An already-finished identification is reused rather than repeated. This
    // is what makes it safe to call useIdentify({ immediate: true }) in as many
    // components as want it.
    //
    // Keyed on the *report*, not on the requestId. Keying on the requestId
    // looked equivalent and was not: under `submit: false` nothing is sent, so
    // there is no requestId, so the cache never engaged and every caller
    // re-collected the whole fingerprint. Having a report is what "already
    // identified" means; a requestId is only what submitting adds to it.
    if (!identifyOptions.force && completed) {
      // Keep the original object: deferred is a live completion promise and
      // cannot be reconstructed from the view-oriented refs below.
      return Promise.resolve(completed)
    }

    // Holding off after a failure; see failureHold.
    const now = Date.now()
    if (held && (now < held.until || (identifyOptions.automatic && now < held.automaticUntil))) {
      return Promise.reject(held.error)
    }

    state.isLoading.value = true
    state.error.value = null

    const run = client()
      .then((fingerly) =>
        fingerly.identify({
          ...(identifyOptions.tag === undefined ? {} : { tag: identifyOptions.tag }),
          ...(options.submit === undefined ? {} : { submit: options.submit }),
        }),
      )
      .then((result) => {
        state.requestId.value = result.requestId === '' ? null : result.requestId
        state.visitorId.value = result.visitorId === '' ? null : result.visitorId
        state.visitorIsNew.value = result.visitorIsNew
        state.visitorConfidence.value = result.visitorConfidence
        state.identifiable.value = result.identifiable
        state.duplicate.value = result.duplicate
        state.state.value = result.state === '' ? null : result.state
        state.reason.value = result.reason === '' ? null : result.reason
        state.suspectScore.value = result.suspectScore
        state.suspectLevel.value = result.suspectLevel
        state.triggers.value = result.triggers
        state.verdicts.value = result.verdicts
        state.report.value = result.report
        completed = result
        held = undefined
        consecutiveFailures = 0
        return result
      })
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        state.error.value = error
        consecutiveFailures += 1
        held = { error, ...failureHold(error, consecutiveFailures, Date.now()) }
        // Rethrown as well as stored. A caller that awaited identify() should
        // be able to try/catch it; a template that only watches `error` should
        // not have to.
        throw error
      })
      .finally(() => {
        state.isLoading.value = false
        if (inFlight === run) inFlight = undefined
      })

    inFlight = run
    return run
  }

  const context: FingerlyContext = { options, state, client, setConsent, identify }

  return {
    install(app: App) {
      app.provide(fingerlyKey, context)
      // Also on globalProperties, so an Options-API component can reach it as
      // `this.$fingerly` without a composable. Vue 3 apps are not all written in
      // `<script setup>`, and a fraud check is exactly the kind of thing that
      // gets retrofitted into an older component.
      app.config.globalProperties.$fingerly = context
    },
  }
}

/** Readonly views of the shared state, for returning from composables. */
export type ReadonlyState = {
  requestId: Readonly<ShallowRef<string | null>>
  visitorId: Readonly<ShallowRef<string | null>>
  visitorIsNew: Readonly<ShallowRef<boolean>>
  visitorConfidence: Readonly<ShallowRef<number>>
  identifiable: Readonly<ShallowRef<boolean>>
  duplicate: Readonly<ShallowRef<boolean>>
  state: Readonly<ShallowRef<string | null>>
  reason: Readonly<ShallowRef<string | null>>
  suspectScore: Readonly<ShallowRef<number | null>>
  suspectLevel: Readonly<ShallowRef<string | null>>
  triggers: Readonly<ShallowRef<IdentifyTrigger[]>>
  verdicts: Readonly<ShallowRef<DeepReadonly<Verdicts> | null>>
  report: Readonly<ShallowRef<DeepReadonly<SignalReport> | null>>
  error: Readonly<ShallowRef<Error | null>>
  isLoading: Readonly<Ref<boolean>>
  consent: Readonly<ShallowRef<ConsentState>>
}

export function toReadonly(state: FingerlyState): ReadonlyState {
  return {
    requestId: readonly(state.requestId),
    visitorId: readonly(state.visitorId),
    visitorIsNew: readonly(state.visitorIsNew),
    visitorConfidence: readonly(state.visitorConfidence),
    identifiable: readonly(state.identifiable),
    duplicate: readonly(state.duplicate),
    state: readonly(state.state),
    reason: readonly(state.reason),
    suspectScore: readonly(state.suspectScore),
    suspectLevel: readonly(state.suspectLevel),
    // shallowReadonly, not readonly: the array is replaced wholesale on every
    // identification and never mutated in place, so deep-freezing each element
    // buys nothing and costs the element type - a DeepReadonly<IdentifyTrigger>
    // is not an IdentifyTrigger, and a consumer would have to widen it back.
    triggers: shallowReadonly(state.triggers),
    verdicts: readonly(state.verdicts) as ReadonlyState['verdicts'],
    report: readonly(state.report) as ReadonlyState['report'],
    error: readonly(state.error) as ReadonlyState['error'],
    isLoading: readonly(state.isLoading),
    consent: readonly(state.consent),
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $fingerly: FingerlyContext
  }
}
