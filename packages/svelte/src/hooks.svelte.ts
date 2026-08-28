/**
 * The two things a component asks for: the identification, and one verdict.
 *
 * Named `useIdentify` and `useVerdict` to match the Vue, React and Next
 * bindings rather than to follow any Svelte convention. An SDK whose four
 * bindings answer the same question under four different names makes its own
 * documentation harder to read than the code it documents. What is Svelte's
 * here is the *shape*: reactive objects read as plain properties, no refs, no
 * `$` prefix, no subscription.
 */

import type { Confidence, Verdict, Verdicts } from '@badele/web-js'

import { useBadele } from './context.js'
import type { Badele } from './state.svelte.js'

export type VerdictName = keyof Verdicts

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
 *   import { useIdentify } from '@badele/svelte'
 *   const badele = useIdentify({ immediate: true })
 * </script>
 *
 * {#if badele.isReady && badele.isSuspicious}
 *   <p>Something about this session is unusual.</p>
 * {/if}
 * ```
 *
 * Returns the same object `setupBadele()` created, so `badele.verdicts` in a
 * template re-renders when the answer arrives.
 */
export function useIdentify(options: UseIdentifyOptions = {}): Badele {
  const badele = useBadele()

  const resolveTag = (override?: string): string | undefined =>
    override ?? (typeof options.tag === 'function' ? options.tag() : options.tag)

  // Wrapped rather than handed back as-is, so that `tag` applies to every call
  // this component makes and not only to the one `immediate` starts. The
  // getters below forward to the shared state, so the reactivity is the same
  // object's - what is per-component here is the tag, and nothing else.
  const identify: Badele['identify'] = (callOptions = {}) => {
    const tag = resolveTag(callOptions.tag)
    return badele.identify({
      ...(tag === undefined ? {} : { tag }),
      ...(callOptions.force === undefined ? {} : { force: callOptions.force }),
    })
  }

  const refresh: Badele['refresh'] = (callOptions = {}) => identify({ ...callOptions, force: true })

  if (options.immediate) {
    $effect(() => {
      // The rejection is swallowed rather than left to become an unhandled
      // one: the failure is already in `badele.error`, which is where a
      // component that opted into `immediate` will look for it. A caller who
      // wants to await the outcome calls identify() themselves.
      void identify().catch(() => undefined)
    })
  }

  return {
    get requestId() {
      return badele.requestId
    },
    get verdicts() {
      return badele.verdicts
    },
    get report() {
      return badele.report
    },
    get error() {
      return badele.error
    },
    get isLoading() {
      return badele.isLoading
    },
    get isReady() {
      return badele.isReady
    },
    get isSuspicious() {
      return badele.isSuspicious
    },
    identify,
    refresh,
    client: badele.client,
  }
}

export interface UseVerdictReturn {
  /** True only when the verdict fired *and* met the confidence floor. */
  readonly matched: boolean
  /** The verdict itself, or null before the first identification. */
  readonly verdict: Verdict | null
  readonly confidence: Confidence | null
  /** Why, strongest first. Empty before identification, never null. */
  readonly reasons: readonly string[]
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

/** One array for every un-identified verdict, rather than one per read. */
const NO_REASONS: readonly string[] = Object.freeze([])

/**
 * Watch one verdict.
 *
 * ```svelte
 * <script lang="ts">
 *   const incognito = useVerdict('incognito')
 * </script>
 *
 * {#if incognito.matched}Private window ({incognito.confidence}){/if}
 * ```
 *
 * `min` defaults to `medium`. A `low`-confidence verdict is a single weak tell
 * - one removable flag, or one countermeasure a privacy-conscious real user
 * might equally be running - and defaulting to acting on it would make this a
 * false-positive generator. Pass `min: 'low'` deliberately if the intent is to
 * observe rather than to block.
 */
export function useVerdict(
  name: VerdictName | (() => VerdictName),
  options: { min?: Confidence | (() => Confidence) } = {},
): UseVerdictReturn {
  const badele = useBadele()

  // Getters accepted as well as values, because this is called once when the
  // component initialises and its arguments may be props that change after
  // that. A plain value read here would be the value that prop had at
  // initialisation, forever.
  const which = $derived(typeof name === 'function' ? name() : name)
  const floor = $derived(
    (typeof options.min === 'function' ? options.min() : options.min) ?? 'medium',
  )

  const verdict = $derived(badele.verdicts ? (badele.verdicts[which] as Verdict) : null)
  const matched = $derived(
    verdict !== null && verdict.value && RANK[verdict.confidence] >= RANK[floor],
  )

  return {
    get verdict() {
      return verdict
    },
    get confidence() {
      return verdict?.confidence ?? null
    },
    get reasons() {
      return verdict?.reasons ?? NO_REASONS
    },
    get matched() {
      return matched
    },
  }
}
