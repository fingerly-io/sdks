/**
 * `useIdentify()` - the composable a page actually uses.
 */

import type { IdentifyResult } from '@fingerly/web-js'
import {
  computed,
  onMounted,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue'

import { toReadonly, type ReadonlyState } from './plugin.js'
import { useFingerly } from './useFingerly.js'

export interface UseIdentifyOptions {
  /**
   * Identify as soon as the component mounts.
   *
   * Safe to pass in every component that wants it: the plugin holds one shared
   * result, so the second and third callers get the first one's answer rather
   * than starting their own submission.
   *
   * It runs in `onMounted`, which is what makes it server-safe - the hook does
   * not run during SSR, so a Nuxt page using this renders on the server and
   * collects on the client without a guard of its own.
   */
  immediate?: boolean
  /**
   * The customer's own correlation value, echoed back on the finished event.
   *
   * Accepts a ref or a getter as well as a string, so it can be `() =>
   * route.params.orderId` and be read at the moment of submission rather than
   * at the moment the component set itself up.
   */
  tag?: MaybeRefOrGetter<string | undefined>
}

export interface UseIdentifyReturn extends ReadonlyState {
  /** True once an identification has completed, successfully or not. */
  isReady: ComputedRef<boolean>
  /**
   * True when the verdicts contain anything worth acting on.
   *
   * A convenience over the five verdicts, and deliberately conservative: it
   * requires `medium` confidence or better, because a `low`-confidence verdict
   * is one weak tell and blocking on it would be blocking real users. Anything
   * more nuanced should read `verdicts` directly - this is the "should I even
   * look?" flag, not a policy.
   */
  isSuspicious: ComputedRef<boolean>
  /** Collect, score and submit. Reuses a completed run unless `force`. */
  identify: (options?: { tag?: string; force?: boolean }) => Promise<IdentifyResult>
  /** Identify again from scratch, ignoring any previous result. */
  refresh: (options?: { tag?: string }) => Promise<IdentifyResult>
}

/**
 * Identify this visitor.
 *
 * ```vue
 * <script setup lang="ts">
 * const { verdicts, isSuspicious, isLoading, identify } = useIdentify()
 * </script>
 * ```
 *
 * Every field returned is readonly. The state is shared across the app, so a
 * component that could assign to it would be changing what every other
 * component sees.
 */
export function useIdentify(options: UseIdentifyOptions = {}): UseIdentifyReturn {
  const fingerly = useFingerly()
  const state = toReadonly(fingerly.state)

  const resolveTag = (override?: string): string | undefined =>
    override ?? toValue(options.tag)

  const identify: UseIdentifyReturn['identify'] = (callOptions = {}) => {
    const tag = resolveTag(callOptions.tag)
    return fingerly.identify({
      ...(tag === undefined ? {} : { tag }),
      ...(callOptions.force === undefined ? {} : { force: callOptions.force }),
    })
  }

  const refresh: UseIdentifyReturn['refresh'] = (callOptions = {}) =>
    identify({ ...callOptions, force: true })

  if (options.immediate) {
    onMounted(() => {
      // The rejection is deliberately swallowed here rather than left to become
      // an unhandled rejection: the failure is already in `state.error`, which
      // is where a component that opted into `immediate` will look for it. A
      // caller who wants to await the outcome calls identify() themselves.
      void identify().catch(() => undefined)
    })
  }

  return {
    ...state,
    isReady: computed(() => state.report.value !== null || state.error.value !== null),
    isSuspicious: computed(() => {
      const verdicts = state.verdicts.value
      if (!verdicts) return false
      return Object.values(verdicts).some(
        (verdict) => verdict.value && verdict.confidence !== 'low',
      )
    }),
    identify,
    refresh,
  }
}
