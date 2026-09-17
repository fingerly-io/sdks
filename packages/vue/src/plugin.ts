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
}

/** What the plugin provides. Reach it with `useFingerly()`. */
export interface FingerlyContext {
  readonly options: FingerlyVueOptions
  readonly state: FingerlyState
  /** The underlying client, built on first use. */
  client(): Promise<FingerlyClient>
  /**
   * Identify, at most once unless asked otherwise.
   *
   * Concurrent callers share the in-flight promise; later callers get the
   * result already in `state` without a second submission. `force` starts a
   * fresh one, which is what a long-lived SPA wants before a second checkout.
   */
  identify(options?: { tag?: string; force?: boolean }): Promise<IdentifyResult>
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

function createState(): FingerlyState {
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
  }
}

/**
 * Build the plugin.
 *
 * ```ts
 * app.use(createFingerly({ apiKey: 'fly_pk_us_production_…' }))
 * ```
 *
 * Nothing is collected here. Installing the plugin only makes the client
 * available - a plugin that fingerprinted on install would run before the app
 * has rendered and during SSR, and would take the choice of *when* away from
 * the page that knows.
 */
export function createFingerly(options: FingerlyVueOptions): Plugin {
  const state = createState()

  let clientPromise: Promise<FingerlyClient> | undefined
  let inFlight: Promise<IdentifyResult> | undefined
  let completed: IdentifyResult | undefined

  const client = (): Promise<FingerlyClient> => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())
    // Built once and memoised. `load()` is cheap today but is the documented
    // place for future warm-up work, and warming up per component would undo it.
    clientPromise ??= load({
      apiKey: options.apiKey,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      ...(options.endpoints === undefined ? {} : { endpoints: options.endpoints }),
      ...(options.fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint: options.fallbackToDefaultEndpoint }),
    })
    return clientPromise
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
        return result
      })
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        state.error.value = error
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

  const context: FingerlyContext = { options, state, client, identify }

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
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $fingerly: FingerlyContext
  }
}
