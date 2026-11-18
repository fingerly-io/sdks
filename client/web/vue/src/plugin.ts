/**
 * The Vue plugin, and the state every composable shares (`0.4.0`, single-pass `v: 3`).
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
import {
  readonly,
  ref,
  shallowRef,
  type App,
  type InjectionKey,
  type Plugin,
  type Ref,
  type ShallowRef,
} from 'vue'

/** Options for [[createFingerly]]. */
/**
 * What the plugin hands back from `identify()`: the result without the full
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

export interface FingerlyVueOptions {
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
  /** Whether the visitor has agreed to be identified. Defaults to `pending`. */
  consent?: ConsentState
}

/** The shared, reactive result of the app's one identification. */
export interface FingerlyState {
  requestId: ShallowRef<string | null>
  /**
   * `null` before an identification has completed; afterwards `result.visitorId`
   * (`""` when `identifiable === false` under Option B).
   */
  visitorId: ShallowRef<string | null>
  visitorIsNew: ShallowRef<boolean>
  visitorConfidence: ShallowRef<number>
  identifiable: ShallowRef<boolean>
  duplicate: ShallowRef<boolean>
  state: ShallowRef<string | null>
  suspectScore: ShallowRef<number | null>
  suspectLevel: ShallowRef<SuspectLevel | null>
  /** True once an identification has succeeded. */
  identified: ShallowRef<boolean>
  error: ShallowRef<Error | null>
  isLoading: Ref<boolean>
  consent: ShallowRef<ConsentState>
}

/** What the plugin provides. Reach it with `useFingerly()`. */
export interface FingerlyContext {
  readonly options: FingerlyVueOptions
  readonly state: FingerlyState
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
  const backoff =
    failure?.retryable === true ? Math.min(60_000, 5_000 * 2 ** Math.max(0, consecutive - 1)) : 0
  return { until: now + retryAfter, automaticUntil: now + Math.max(retryAfter, backoff) }
}

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
    requestId: shallowRef<string | null>(null),
    visitorId: shallowRef<string | null>(null),
    visitorIsNew: shallowRef(false),
    visitorConfidence: shallowRef(0),
    identifiable: shallowRef(false),
    duplicate: shallowRef(false),
    state: shallowRef<string | null>(null),
    suspectScore: shallowRef<number | null>(null),
    suspectLevel: shallowRef<SuspectLevel | null>(null),
    identified: shallowRef(false),
    error: shallowRef<Error | null>(null),
    isLoading: ref(false),
    consent: shallowRef(consent),
  }
}

export function createFingerly(options: FingerlyVueOptions): Plugin {
  const state = createState(options.consent ?? 'pending')

  let clientPromise: Promise<FingerlyClient> | undefined
  let loaded: FingerlyClient | undefined
  let inFlight: Promise<IdentifyAnswer> | undefined
  let completed: IdentifyAnswer | undefined
  let held: { error: Error; until: number; automaticUntil: number } | undefined
  let consecutiveFailures = 0

  const mirrorConsent = (consent: ConsentState): void => {
    state.consent.value = consent
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
        consent: state.consent.value,
      }).then((fingerly) => {
        if (fingerly.consent !== state.consent.value) fingerly.setConsent(state.consent.value)
        fingerly.onConsentChange(mirrorConsent)
        loaded = fingerly
        return fingerly
      }),
    )
    return clientPromise
  }

  const setConsent: FingerlyContext['setConsent'] = (consent) => {
    loaded?.setConsent(consent)
    mirrorConsent(consent)
  }

  const identify: FingerlyContext['identify'] = (identifyOptions = {}) => {
    if (typeof window === 'undefined') return Promise.reject(new FingerlyServerError())

    if (inFlight && !identifyOptions.force) return inFlight

    if (!identifyOptions.force && completed) {
      return Promise.resolve(completed)
    }

    const now = Date.now()
    if (held && (now < held.until || (identifyOptions.automatic && now < held.automaticUntil))) {
      return Promise.reject(held.error)
    }

    state.isLoading.value = true
    state.error.value = null

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
        state.requestId.value = result.requestId === '' ? null : result.requestId
        state.visitorId.value = result.visitorId
        state.visitorIsNew.value = result.visitorIsNew
        state.visitorConfidence.value = result.visitorConfidence
        state.identifiable.value = result.identifiable
        state.duplicate.value = result.duplicate ?? false
        state.state.value = result.state === '' ? null : result.state
        state.suspectScore.value = result.suspectScore ?? null
        state.suspectLevel.value = result.suspectLevel ?? null
        state.identified.value = true
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
  suspectScore: Readonly<ShallowRef<number | null>>
  suspectLevel: Readonly<ShallowRef<SuspectLevel | null>>
  identified: Readonly<ShallowRef<boolean>>
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
    suspectScore: readonly(state.suspectScore),
    suspectLevel: readonly(state.suspectLevel),
    identified: readonly(state.identified),
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
