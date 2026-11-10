/**
 * What a component asks for: the identification.
 *
 * Named `useIdentify` to match the Vue, React and Next
 * bindings rather than to follow any Svelte convention. An SDK whose four
 * bindings answer the same question under four different names makes its own
 * documentation harder to read than the code it documents. What is Svelte's
 * here is the *shape*: reactive objects read as plain properties, no refs, no
 * `$` prefix, no subscription.
 */

import { useFingerly } from './context.js'
import type { Fingerly } from './state.svelte.js'

export interface UseIdentifyOptions {
  /**
   * Identify as soon as the component mounts.
   *
   * Safe to pass in every component that wants it: the context holds one
   * shared identification, so the second and third callers get the first
   * one's answer rather than starting their own submission.
   *
   * It runs in an `$effect`, which is what makes it server-safe - effects do
   * not run during SSR, so a SvelteKit page using this renders on the server
   * and collects on the client without a guard of its own.
   *
   * It waits for consent. While `consent` is `pending` or `denied` nothing is
   * started, and the identification begins once it becomes `granted`.
   */
  immediate?: boolean
  /**
   * The customer's own correlation value, echoed back on the finished event.
   *
   * Accepts a getter as well as a string, so it can be
   * `() => page.params.orderId` and be read at the moment of submission
   * rather than at the moment the component initialised.
   */
  tag?: string | (() => string | undefined)
}

/**
 * The shared identification, optionally started on mount.
 *
 * ```svelte
 * <script lang="ts">
 *   import { useIdentify } from '@fingerly/svelte'
 *   const fingerly = useIdentify({ immediate: true })
 * </script>
 *
 * {#if fingerly.isReady && fingerly.isSuspicious}
 *   <p>Something about this session is unusual.</p>
 * {/if}
 * ```
 *
 * Returns the same object `setupFingerly()` created, so `fingerly.suspectLevel`
 * in a template re-renders when the answer arrives.
 */
export function useIdentify(options: UseIdentifyOptions = {}): Fingerly {
  const fingerly = useFingerly()

  const resolveTag = (override?: string): string | undefined =>
    override ?? (typeof options.tag === 'function' ? options.tag() : options.tag)

  // Wrapped rather than handed back as-is, so that `tag` applies to every call
  // this component makes and not only to the one `immediate` starts. The
  // getters below forward to the shared state, so the reactivity is the same
  // object's - what is per-component here is the tag, and nothing else.
  const identify: Fingerly['identify'] = (callOptions = {}) => {
    const tag = resolveTag(callOptions.tag)
    return fingerly.identify({
      ...(tag === undefined ? {} : { tag }),
      ...(callOptions.force === undefined ? {} : { force: callOptions.force }),
    })
  }

  const refresh: Fingerly['refresh'] = (callOptions = {}) => identify({ ...callOptions, force: true })

  if (options.immediate) {
    $effect(() => {
      // Reading `consent` is what makes this effect run again when a banner is
      // accepted after mount. Once: the shared state memoises the run, so
      // consent flipping back and forth afterwards submits nothing more.
      if (fingerly.consent !== 'granted') return
      // The rejection is swallowed rather than left to become an unhandled
      // one: the failure is already in `fingerly.error`, which is where a
      // component that opted into `immediate` will look for it. A caller who
      // wants to await the outcome calls identify() themselves.
      // Marked automatic, so a failure's hold applies: a remount while the
      // API is refusing must not send another identification.
      const tag = resolveTag()
      void fingerly.identify({ ...(tag === undefined ? {} : { tag }), automatic: true }).catch(() => undefined)
    })
  }

  return {
    get requestId() {
      return fingerly.requestId
    },
    get visitorId() {
      return fingerly.visitorId
    },
    get visitorIsNew() {
      return fingerly.visitorIsNew
    },
    get visitorConfidence() {
      return fingerly.visitorConfidence
    },
    get identifiable() {
      return fingerly.identifiable
    },
    get duplicate() {
      return fingerly.duplicate
    },
    get state() {
      return fingerly.state
    },
    get suspectScore() {
      return fingerly.suspectScore
    },
    get suspectLevel() {
      return fingerly.suspectLevel
    },
    get report() {
      return fingerly.report
    },
    get error() {
      return fingerly.error
    },
    get isLoading() {
      return fingerly.isLoading
    },
    get isReady() {
      return fingerly.isReady
    },
    get isSuspicious() {
      return fingerly.isSuspicious
    },
    get consent() {
      return fingerly.consent
    },
    setConsent: fingerly.setConsent,
    identify,
    refresh,
    client: fingerly.client,
  }
}
