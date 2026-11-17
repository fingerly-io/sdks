/**
 * `useIdentify()` - the composable a page actually uses.
 */

import { isSuspiciousLevel, type IncognitoDetection } from '@fingerly/web-js'
import {
  computed,
  onMounted,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue'

import { toReadonly, type IdentifyAnswer, type ReadonlyState } from './plugin.js'
import { useFingerly } from './useFingerly.js'

export interface UseIdentifyOptions {
  /** Identify as soon as the component mounts (after consent is `'granted'`). */
  immediate?: boolean
  /** Opaque correlation label echoed on the event. */
  tag?: MaybeRefOrGetter<string | undefined>
  /** Opt-in extended incognito probe control (`'standard'` or `'extended'`). */
  incognitoDetection?: MaybeRefOrGetter<IncognitoDetection | undefined>
}

export interface UseIdentifyReturn extends ReadonlyState {
  /** True once an identification has completed, successfully or not. */
  isReady: ComputedRef<boolean>
  /**
   * True when the server scored this `medium` or `high`; `null` when absent.
   * A UI hint only: access decisions belong on your backend, which reads the
   * event by `requestId` with the secret key.
   */
  isSuspicious: ComputedRef<boolean | null>
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

export function useIdentify(options: UseIdentifyOptions = {}): UseIdentifyReturn {
  const fingerly = useFingerly()
  const state = toReadonly(fingerly.state)

  const resolveTag = (override?: string): string | undefined =>
    override ?? toValue(options.tag)
  const resolveIncognito = (
    override?: IncognitoDetection,
  ): IncognitoDetection | undefined => override ?? toValue(options.incognitoDetection)

  const identify: UseIdentifyReturn['identify'] = (callOptions = {}) => {
    const tag = resolveTag(callOptions.tag)
    const incognitoDetection = resolveIncognito(callOptions.incognitoDetection)
    return fingerly.identify({
      ...(tag === undefined ? {} : { tag }),
      ...(incognitoDetection === undefined ? {} : { incognitoDetection }),
      ...(callOptions.force === undefined ? {} : { force: callOptions.force }),
    })
  }

  const refresh: UseIdentifyReturn['refresh'] = (callOptions = {}) =>
    identify({ ...callOptions, force: true })

  if (options.immediate) {
    onMounted(() => {
      watch(
        () => fingerly.state.consent.value === 'granted',
        (consented) => {
          if (!consented) return
          const tag = resolveTag()
          const incognitoDetection = resolveIncognito()
          void fingerly
            .identify({
              ...(tag === undefined ? {} : { tag }),
              ...(incognitoDetection === undefined ? {} : { incognitoDetection }),
              automatic: true,
            })
            .catch(() => undefined)
        },
        { immediate: true },
      )
    })
  }

  return {
    ...state,
    isReady: computed(() => state.identified.value || state.error.value !== null),
    isSuspicious: computed(() => isSuspiciousLevel(state.suspectLevel.value)),
    identify,
    refresh,
  }
}
