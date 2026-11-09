/**
 * `useVerdict()` - one verdict, as a ref.
 *
 * Deprecated: read `suspectLevel` from `useIdentify()`, and read signals on
 * your backend. A browser is no longer told which signals fired, so this holds
 * nothing.
 */

import { warnDeprecated, type Confidence, type Verdict, type Verdicts } from '@fingerly/web-js'
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'

import { toReadonly } from './plugin.js'
import { useFingerly } from './useFingerly.js'

export type VerdictName = keyof Verdicts

export interface UseVerdictReturn {
  /**
   * `null`: a browser is no longer told which signals fired, and nobody
   * reporting is not a clean result. Read signals on your backend.
   */
  matched: ComputedRef<boolean | null>
  /** The verdict itself, or null before the first identification. */
  verdict: ComputedRef<Verdict | null>
  confidence: ComputedRef<Confidence | null>
  /** Why, strongest first. Empty before identification, never null. */
  reasons: ComputedRef<readonly string[]>
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

/**
 * @deprecated Read `suspectLevel` from `useIdentify()`, and read signals on your backend.
 *
 * Watch one verdict. Holds nothing now: `matched` is `null`, never a false clean.
 *
 * ```ts
 * const { matched, reasons } = useVerdict('automation', { min: 'high' })
 * ```
 *
 * `min` defaults to `medium`. Pass `min: 'low'` deliberately if the intent is
 * to observe rather than to block.
 */
export function useVerdict(
  name: MaybeRefOrGetter<VerdictName>,
  options: { min?: MaybeRefOrGetter<Confidence> } = {},
): UseVerdictReturn {
  warnDeprecated('useVerdict', 'read suspectLevel from useIdentify() instead, and read signals on your backend. This holds nothing now.')
  const fingerly = useFingerly()
  const { verdicts } = toReadonly(fingerly.state)

  const verdict = computed<Verdict | null>(() => {
    const all = verdicts.value
    return all ? (all[toValue(name)] as Verdict) : null
  })

  return {
    verdict,
    confidence: computed(() => verdict.value?.confidence ?? null),
    reasons: computed(() => verdict.value?.reasons ?? []),
    // Null when the server has not answered, which is the difference between
    // "the server looked and found nothing" and "nobody looked".
    matched: computed(() => {
      const current = verdict.value
      if (!current || current.value === null) return null
      if (current.value !== true) return false
      return RANK[current.confidence] >= RANK[toValue(options.min) ?? 'medium']
    }),
  }
}
