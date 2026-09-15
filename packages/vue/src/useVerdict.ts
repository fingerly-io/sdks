/**
 * `useVerdict()` - one verdict, as a ref.
 *
 * Exists because the common case in a template is a single question: "is this
 * an emulator?". Reaching that through `verdicts?.emulator?.value` is three
 * optional accesses and one of them is called `value` next to a ref that also
 * has a `.value`, which is exactly the sort of thing that reads correctly and
 * is wrong.
 */

import type { Confidence, Verdict, Verdicts } from '@fingerly/web-js'
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'

import { toReadonly } from './plugin.js'
import { useFingerly } from './useFingerly.js'

export type VerdictName = keyof Verdicts

export interface UseVerdictReturn {
  /** True only when the verdict fired *and* met the confidence floor. */
  matched: ComputedRef<boolean>
  /** The verdict itself, or null before the first identification. */
  verdict: ComputedRef<Verdict | null>
  confidence: ComputedRef<Confidence | null>
  /** Why, strongest first. Empty before identification, never null. */
  reasons: ComputedRef<readonly string[]>
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

/**
 * Watch one verdict.
 *
 * ```ts
 * const { matched, reasons } = useVerdict('automation', { min: 'high' })
 * ```
 *
 * `min` defaults to `medium`. A `low`-confidence verdict is a single weak tell
 * - one removable flag, or one countermeasure that a privacy-conscious real
 * user might equally be running - and defaulting to acting on it would make
 * this composable a false-positive generator. Pass `min: 'low'` deliberately if
 * the intent is to observe rather than to block.
 */
export function useVerdict(
  name: MaybeRefOrGetter<VerdictName>,
  options: { min?: MaybeRefOrGetter<Confidence> } = {},
): UseVerdictReturn {
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
    matched: computed(() => {
      const current = verdict.value
      if (!current?.value) return false
      return RANK[current.confidence] >= RANK[toValue(options.min) ?? 'medium']
    }),
  }
}
