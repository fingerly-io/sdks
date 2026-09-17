'use client'

/**
 * `useIdentify()` - the hook a page actually uses.
 */

import type { IdentifyResult } from '@fingerly/web-js'
import {
  use,
  useCallback,
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'

import { useFingerly } from './useFingerly.js'
import type { FingerlyState } from './store.js'

export interface UseIdentifyOptions {
  /**
   * Identify as soon as the component mounts.
   *
   * Safe to pass in every component that wants it: the provider holds one
   * shared identification, so the second and third callers get the first
   * one's answer rather than starting their own submission. Safe under
   * StrictMode for the same reason - the double mount React does in
   * development to surface effect bugs costs nothing here.
   *
   * It runs in an effect, which is what makes it server-safe: effects do not
   * run during SSR, so a Next.js page using this renders on the server and
   * collects on the client without a guard of its own.
   *
   * It waits for consent. While `consent` is `pending` or `denied` nothing is
   * started, and the identification begins once it becomes `granted`.
   */
  immediate?: boolean
  /**
   * Suspend this component until the first identification finishes.
   *
   * Reads the identification with `use()`, so the nearest `<Suspense>`
   * fallback shows while it collects and the nearest error boundary catches a
   * failure. The alternative - rendering a spinner from `isLoading` - is still
   * there and is still the default; this is for a component that has nothing
   * meaningful to render until it has the answer.
   *
   * Client-only by construction: on the server there is no browser to collect
   * from, so it renders the unidentified state exactly as `immediate` does
   * and suspends after hydration instead.
   *
   * Consent-gated the same way as `immediate`: while consent is not granted it
   * renders the unidentified state rather than suspending, and suspends once
   * consent is granted.
   */
  suspend?: boolean
  /**
   * The customer's own correlation value, echoed back on the finished event.
   *
   * Accepts a getter as well as a string, so it can be
   * `() => params.orderId` and be read at the moment of submission rather than
   * at the moment the component rendered.
   */
  tag?: string | (() => string | undefined)
}

export interface UseIdentifyReturn extends FingerlyState {
  /** True once an identification has completed, successfully or not. */
  isReady: boolean
  /**
   * True when the verdicts contain anything worth acting on.
   *
   * A convenience over the five verdicts, and deliberately conservative: it
   * requires `medium` confidence or better, because a `low`-confidence verdict
   * is one weak tell and blocking on it would be blocking real users. Anything
   * more nuanced should read `verdicts` directly - this is the "should I even
   * look?" flag, not a policy.
   */
  isSuspicious: boolean
  /** Collect, score and submit. Reuses a completed run unless `force`. */
  identify: (options?: { tag?: string; force?: boolean }) => Promise<IdentifyResult>
  /** Identify again from scratch, ignoring any previous result. */
  refresh: (options?: { tag?: string }) => Promise<IdentifyResult>
}

const resolveTag = (tag: UseIdentifyOptions['tag']): string | undefined =>
  typeof tag === 'function' ? tag() : tag

/**
 * Identify this visitor.
 *
 * ```tsx
 * const { verdicts, isSuspicious, isLoading, identify } = useIdentify({ immediate: true })
 * ```
 *
 * The state comes through `useSyncExternalStore`, so every component that
 * calls this sees the same identification at the same time - no tearing, and
 * no second submission.
 */
export function useIdentify(options: UseIdentifyOptions = {}): UseIdentifyReturn {
  const fingerly = useFingerly()

  const state = useSyncExternalStore(fingerly.subscribe, fingerly.getState, fingerly.getServerState)

  // The latest tag, kept where a callback can read it without being rebuilt
  // when it changes. Synced in an effect rather than assigned during render
  // because a render can be thrown away under concurrent rendering, and a
  // discarded render must not leave its tag behind. Declared before the
  // effect that identifies, so the tag is current by the time it runs.
  const tagRef = useRef(options.tag)
  useEffect(() => {
    tagRef.current = options.tag
  }, [options.tag])

  const identify = useCallback<UseIdentifyReturn['identify']>(
    (callOptions = {}) => {
      const tag = callOptions.tag ?? resolveTag(tagRef.current)
      return fingerly.identify({
        ...(tag === undefined ? {} : { tag }),
        ...(callOptions.force === undefined ? {} : { force: callOptions.force }),
      })
    },
    [fingerly],
  )

  const refresh = useCallback<UseIdentifyReturn['refresh']>(
    (callOptions = {}) => identify({ ...callOptions, force: true }),
    [identify],
  )

  const { immediate = false, suspend = false } = options
  const consented = state.consent === 'granted'

  useEffect(() => {
    // Keyed on consent as well, so a banner accepted after mount starts the
    // identification that was waiting for it. Once: the store memoises the
    // run, so consent flipping back and forth afterwards submits nothing more.
    if (!immediate || !consented) return
    // The rejection is swallowed here rather than left to become an unhandled
    // one: the failure is already in `error`, which is where a component that
    // opted into `immediate` will look for it. A caller who wants to await the
    // outcome calls identify() themselves.
    void identify().catch(() => undefined)
  }, [immediate, consented, identify])

  // Suspending reads the same memoised promise the store hands everyone else,
  // which is what makes this legal: `use()` recognises a pending value by the
  // promise's identity, and a fresh promise per render would suspend forever.
  if (suspend && consented && typeof window !== 'undefined' && state.report === null) {
    use(identify())
  }

  const isReady = state.report !== null || state.error !== null
  const isSuspicious = useMemo(() => {
    if (!state.verdicts) return false
    return Object.values(state.verdicts).some(
      (verdict) => verdict.value && verdict.confidence !== 'low',
    )
  }, [state.verdicts])

  // What React DevTools shows beside the hook, so an inspected component says
  // where the identification got to without expanding five fields.
  useDebugValue(
    isReady ? (isSuspicious ? 'suspicious' : 'clear') : state.isLoading ? 'collecting' : 'idle',
  )

  return { ...state, isReady, isSuspicious, identify, refresh }
}
