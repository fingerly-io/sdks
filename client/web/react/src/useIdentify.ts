'use client'

/**
 * `useIdentify()` - the hook a page actually uses.
 */

import { isSuspiciousLevel, type IncognitoDetection } from '@fingerly/web-js'
import {
  use,
  useCallback,
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'

import type { FingerlyState, IdentifyAnswer } from './store.js'
import { useFingerly } from './useFingerly.js'

export interface UseIdentifyOptions {
  /** Identify as soon as the component mounts (after consent is `'granted'`). */
  immediate?: boolean
  /** Suspend this component until the first identification finishes. */
  suspend?: boolean
  /** Opaque correlation label echoed on the event. */
  tag?: string | (() => string | undefined)
  /** Opt-in extended incognito probe control (`'standard'` or `'extended'`). */
  incognitoDetection?: IncognitoDetection
}

export interface UseIdentifyReturn extends FingerlyState {
  /** True once an identification has completed, successfully or not. */
  isReady: boolean
  /**
   * True when the server scored this `medium` or `high` under the weights you
   * set; `null` when no server has answered or the level is absent.
   */
  isSuspicious: boolean | null
  /** Collect and submit. Reuses a completed run unless `force`. */
  identify: (options?: {
    tag?: string
    incognitoDetection?: IncognitoDetection
    force?: boolean
  }) => Promise<IdentifyAnswer>
  /** Identify again from scratch, ignoring any previous result. */
  refresh: (options?: {
    tag?: string
    incognitoDetection?: IncognitoDetection
  }) => Promise<IdentifyAnswer>
}

const resolveTag = (tag: UseIdentifyOptions['tag']): string | undefined =>
  typeof tag === 'function' ? tag() : tag

export function useIdentify(options: UseIdentifyOptions = {}): UseIdentifyReturn {
  const fingerly = useFingerly()

  const state = useSyncExternalStore(fingerly.subscribe, fingerly.getState, fingerly.getServerState)

  const tagRef = useRef(options.tag)
  const incognitoRef = useRef(options.incognitoDetection)
  useEffect(() => {
    tagRef.current = options.tag
    incognitoRef.current = options.incognitoDetection
  }, [options.tag, options.incognitoDetection])

  const identify = useCallback<UseIdentifyReturn['identify']>(
    (callOptions = {}) => {
      const tag = callOptions.tag ?? resolveTag(tagRef.current)
      const incognitoDetection = callOptions.incognitoDetection ?? incognitoRef.current
      return fingerly.identify({
        ...(tag === undefined ? {} : { tag }),
        ...(incognitoDetection === undefined ? {} : { incognitoDetection }),
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
    if (!immediate || !consented) return
    const tag = resolveTag(tagRef.current)
    const incognitoDetection = incognitoRef.current
    void fingerly
      .identify({
        ...(tag === undefined ? {} : { tag }),
        ...(incognitoDetection === undefined ? {} : { incognitoDetection }),
        automatic: true,
      })
      .catch(() => undefined)
  }, [immediate, consented, fingerly])

  if (suspend && consented && typeof window !== 'undefined' && !state.identified) {
    const tag = resolveTag(tagRef.current)
    const incognitoDetection = options.incognitoDetection
    use(
      fingerly.identify({
        ...(tag === undefined ? {} : { tag }),
        ...(incognitoDetection === undefined ? {} : { incognitoDetection }),
        automatic: true,
      }),
    )
  }

  const isReady = state.identified || state.error !== null
  const isSuspicious = useMemo(() => isSuspiciousLevel(state.suspectLevel), [state.suspectLevel])

  useDebugValue(
    isReady
      ? isSuspicious === null
        ? 'no score'
        : isSuspicious
          ? 'suspicious'
          : 'clear'
      : state.isLoading
        ? 'collecting'
        : 'idle',
  )

  return { ...state, isReady, isSuspicious, identify, refresh }
}
