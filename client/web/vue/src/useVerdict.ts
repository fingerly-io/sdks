/**
 * `useVerdict()` - one verdict, as a ref.
 *
 * Deprecated: read `suspectLevel` and `triggers` from `useIdentify()`. This is
 * derived from the server's triggers, for one transition version, and decides
 * nothing of its own.
 */

import { warnDeprecated, type Confidence, type Verdict, type Verdicts } from '@fingerly/web-js'
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'

import { toReadonly } from './plugin.js'
import { useFingerly } from './useFingerly.js'

export type VerdictName = keyof Verdicts

export interface UseVerdictReturn {
  /**
   * True when the server's trigger fired and met the confidence floor, false
   * when the server answered without it. `null` when no server has answered,
   * which is not a clean result.
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
 * @deprecated Read `suspectLevel` and `triggers` from `useIdentify()`.
 *
 * Watch one verdict, derived from the server's triggers.
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
  warnDeprecated('useVerdict', 'read suspectLevel and triggers from useIdentify() instead.')
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
