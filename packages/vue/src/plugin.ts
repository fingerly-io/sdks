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

import { load, type BadeleClient, type IdentifyResult, type SignalReport, type Verdicts } from '@badele/web-js'
import {
  readonly,
  ref,
  shallowRef,
  type App,
  type DeepReadonly,
  type InjectionKey,
  type Plugin,
  type Ref,
  type ShallowRef,
} from 'vue'

/** Options for [[createBadele]]. Everything `load()` takes, plus Vue's own. */
export interface BadeleVueOptions {
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

/** The shared, reactive result of the app's one identification. */
export interface BadeleState {
  requestId: ShallowRef<string | null>
  verdicts: ShallowRef<Verdicts | null>
  report: ShallowRef<SignalReport | null>
  error: ShallowRef<Error | null>
  isLoading: Ref<boolean>
}

/** What the plugin provides. Reach it with `useBadele()`. */
export interface BadeleContext {
  readonly options: BadeleVueOptions
  readonly state: BadeleState
  /** The underlying client, built on first use. */
  client(): Promise<BadeleClient>
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
export const badeleKey: InjectionKey<BadeleContext> = Symbol('badele')

/** Thrown when the SDK is asked to collect somewhere there is no browser. */
export class BadeleServerError extends Error {
  override readonly name = 'BadeleServerError'
  constructor() {
    super(
      'Badele collects signals from a browser and cannot run during server-side rendering. ' +
        'Call identify() from onMounted, or pass { immediate: true } to useIdentify(), ' +
        'which already waits for the client.',
    )
  }
}

function createState(): BadeleState {
  return {
    // shallowRef throughout: a SignalReport is a large frozen-in-practice
    // object that is replaced wholesale, never edited field by field. Deep
    // reactivity would walk every source on every assignment and buy nothing.
    requestId: shallowRef<string | null>(null),
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
 * app.use(createBadele({ apiKey: 'pk_live_…' }))
 * ```
 *
 * Nothing is collected here. Installing the plugin only makes the client
 * available - a plugin that fingerprinted on install would run before the app
 * has rendered and during SSR, and would take the choice of *when* away from
 * the page that knows.
 */
export function createBadele(options: BadeleVueOptions): Plugin {
  const state = createState()

  let clientPromise: Promise<BadeleClient> | undefined
  let inFlight: Promise<IdentifyResult> | undefined

  const client = (): Promise<BadeleClient> => {
    if (typeof window === 'undefined') return Promise.reject(new BadeleServerError())
    // Built once and memoised. `load()` is cheap today but is the documented
    // place for future warm-up work, and warming up per component would undo it.
    clientPromise ??= load({
      apiKey: options.apiKey,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    })
    return clientPromise
  }

  const identify: BadeleContext['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new BadeleServerError())

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
    if (!identifyOptions.force && state.report.value !== null) {
      return Promise.resolve({
        // Back to the empty string the client uses for "nothing was submitted",
        // so a cached result is indistinguishable from the original.
        requestId: state.requestId.value ?? '',
        verdicts: state.verdicts.value as Verdicts,
        report: state.report.value,
      })
    }

    state.isLoading.value = true
    state.error.value = null

    const run = client()
      .then((badele) =>
        badele.identify({
          ...(identifyOptions.tag === undefined ? {} : { tag: identifyOptions.tag }),
          ...(options.submit === undefined ? {} : { submit: options.submit }),
        }),
      )
      .then((result) => {
        state.requestId.value = result.requestId === '' ? null : result.requestId
        state.verdicts.value = result.verdicts
        state.report.value = result.report
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

  const context: BadeleContext = { options, state, client, identify }

  return {
    install(app: App) {
      app.provide(badeleKey, context)
      // Also on globalProperties, so an Options-API component can reach it as
      // `this.$badele` without a composable. Vue 3 apps are not all written in
      // `<script setup>`, and a fraud check is exactly the kind of thing that
      // gets retrofitted into an older component.
      app.config.globalProperties.$badele = context
    },
  }
}

/** Readonly views of the shared state, for returning from composables. */
export type ReadonlyState = {
  requestId: Readonly<ShallowRef<string | null>>
  verdicts: Readonly<ShallowRef<DeepReadonly<Verdicts> | null>>
  report: Readonly<ShallowRef<DeepReadonly<SignalReport> | null>>
  error: Readonly<ShallowRef<Error | null>>
  isLoading: Readonly<Ref<boolean>>
}

export function toReadonly(state: BadeleState): ReadonlyState {
  return {
    requestId: readonly(state.requestId),
    verdicts: readonly(state.verdicts) as ReadonlyState['verdicts'],
    report: readonly(state.report) as ReadonlyState['report'],
    error: readonly(state.error) as ReadonlyState['error'],
    isLoading: readonly(state.isLoading),
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $badele: BadeleContext
  }
}
