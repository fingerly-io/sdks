/**
 * The shared state, in signals.
 *
 * Angular's own reactive primitive rather than an RxJS subject: a template
 * reads `badele.isSuspicious()` and re-renders, with no subscription to manage
 * and nothing to unsubscribe from when the component goes away. It also works
 * in a zoneless app, which Angular now defaults to.
 *
 * One state per injector, not one per component. Identification is a
 * *page-level* event: three components asking whether the visitor is
 * suspicious should produce one submission and one answer, not three.
 * Per-component state would bill the customer three times for one page load
 * and hand the three components three different `requestId`s for one visitor.
 */

import { computed, signal, type Signal } from '@angular/core'
import {
  load,
  type BadeleClient,
  type IdentifyResult,
  type SignalReport,
  type Verdicts,
} from '@badele/web-js'

/** Options for [[provideBadele]]. */
export interface BadeleOptions {
  /** The SDK key from the dashboard. A public key is safe in a page. */
  apiKey: string
  /** Origin of the API. Defaults to production. */
  endpoint?: string
  /**
   * Collect and score without submitting anything.
   *
   * For an app that wants the local verdicts and nothing else. `requestId`
   * stays null, which is the honest answer: nothing was sent, so there is
   * nothing to fetch later.
   */
  submit?: boolean
}

/** What a component injects. Every field is a signal; none of them is writable. */
export interface Badele {
  readonly requestId: Signal<string | null>
  readonly verdicts: Signal<Verdicts | null>
  readonly report: Signal<SignalReport | null>
  readonly error: Signal<Error | null>
  readonly isLoading: Signal<boolean>
  /** True once an identification has completed, successfully or not. */
  readonly isReady: Signal<boolean>
  /**
   * True when the verdicts contain anything worth acting on.
   *
   * Deliberately conservative: it requires `medium` confidence or better,
   * because a `low`-confidence verdict is one weak tell and blocking on it
   * would be blocking real users. Anything more nuanced should read `verdicts`
   * directly - this is the "should I even look?" flag, not a policy.
   */
  readonly isSuspicious: Signal<boolean>
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
        'Call identify() from afterNextRender, or pass { immediate: true } to injectIdentify(), ' +
        'which already waits for the browser.',
    )
  }
}

/**
 * Build the state.
 *
 * Nothing is collected here. Creating it only makes the client reachable - a
 * factory that fingerprinted as the injector built it would collect during
 * every server render, and would take the choice of *when* away from the
 * component that knows.
 */
export function createBadele(options: BadeleOptions): Badele {
  const requestId = signal<string | null>(null)
  const verdicts = signal<Verdicts | null>(null)
  const report = signal<SignalReport | null>(null)
  const error = signal<Error | null>(null)
  const isLoading = signal(false)

  const isReady = computed(() => report() !== null || error() !== null)
  const isSuspicious = computed(() => {
    const all = verdicts()
    if (!all) return false
    return Object.values(all).some((verdict) => verdict.value && verdict.confidence !== 'low')
  })

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
    // makes `injectIdentify({ immediate: true })` safe in as many components
    // as want it.
    //
    // Memoising the promise rather than the report also settles a case the Vue
    // binding had to learn: under `submit: false` there is no requestId, so a
    // cache keyed on one never engages and every component re-collects the
    // whole fingerprint. A promise has an identity either way.
    if (current && !identifyOptions.force) return current

    isLoading.set(true)
    error.set(null)

    const run = client()
      .then((badele) =>
        badele.identify({
          ...(identifyOptions.tag === undefined ? {} : { tag: identifyOptions.tag }),
          ...(options.submit === undefined ? {} : { submit: options.submit }),
        }),
      )
      .then((result) => {
        requestId.set(result.requestId === '' ? null : result.requestId)
        verdicts.set(result.verdicts)
        report.set(result.report)
        return result
      })
      .catch((cause: unknown) => {
        const failure = cause instanceof Error ? cause : new Error(String(cause))
        error.set(failure)
        // Forgotten, so the next caller retries rather than being handed a
        // rejected promise forever.
        if (current === run) current = undefined
        // Rethrown as well as stored: a caller that awaited identify() should
        // be able to try/catch it, and a template that only reads `error`
        // should not have to.
        throw failure
      })
      .finally(() => {
        isLoading.set(false)
      })

    current = run
    return run
  }

  const refresh: Badele['refresh'] = (refreshOptions = {}) =>
    identify({ ...refreshOptions, force: true })

  // The writable signals are kept in this closure and only their read-only
  // views leave it. The state is shared, so a component that could `set()` it
  // would be changing what every other component sees.
  return {
    requestId: requestId.asReadonly(),
    verdicts: verdicts.asReadonly(),
    report: report.asReadonly(),
    error: error.asReadonly(),
    isLoading: isLoading.asReadonly(),
    isReady,
    isSuspicious,
    identify,
    refresh,
    client,
  }
}
