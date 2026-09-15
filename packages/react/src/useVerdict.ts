'use client'

/**
 * `useVerdict()` - one verdict, and the confidence floor it has to clear.
 *
 * Exists because the common case in a component is a single question: "is this
 * an emulator?". Reaching that through `verdicts?.emulator?.value` is three
 * optional accesses and one of them is called `value`, which is exactly the
 * sort of expression that reads correctly and is wrong.
 */

import type { Confidence, Verdict, Verdicts } from '@fingerly/web-js'
import { useDebugValue, useMemo, useSyncExternalStore } from 'react'

import { useFingerly } from './useFingerly.js'

export type VerdictName = keyof Verdicts

export interface UseVerdictReturn {
  /** True only when the verdict fired *and* met the confidence floor. */
  matched: boolean
  /** The verdict itself, or null before the first identification. */
  verdict: Verdict | null
  confidence: Confidence | null
  /** Why, strongest first. Empty before identification, never null. */
  reasons: readonly string[]
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

/**
 * One array for every un-identified verdict, rather than one per render.
 *
 * `reasons` is the kind of value that ends up in a dependency array, and a
 * fresh `[]` each render makes every such effect run on every render.
 */
const NO_REASONS: readonly string[] = Object.freeze([])

/**
 * Watch one verdict.
 *
 * ```tsx
 * const { matched, reasons } = useVerdict('automation', { min: 'high' })
 * ```
 *
 * `min` defaults to `medium`. A `low`-confidence verdict is a single weak tell
 * - one removable flag, or one countermeasure a privacy-conscious real user
 * might equally be running - and defaulting to acting on it would make this
 * hook a false-positive generator. Pass `min: 'low'` deliberately if the
 * intent is to observe rather than to block.
 */
export function useVerdict(
  name: VerdictName,
  options: { min?: Confidence } = {},
): UseVerdictReturn {
  const fingerly = useFingerly()
  const { verdicts } = useSyncExternalStore(
    fingerly.subscribe,
    fingerly.getState,
    fingerly.getServerState,
  )

  const min = options.min ?? 'medium'

  const result = useMemo<UseVerdictReturn>(() => {
    const verdict = verdicts ? (verdicts[name] as Verdict) : null

    return {
      verdict,
      confidence: verdict?.confidence ?? null,
      reasons: verdict?.reasons ?? NO_REASONS,
      matched: verdict?.value === true && RANK[verdict.confidence] >= RANK[min],
    }
  }, [verdicts, name, min])

  useDebugValue(result, (value) =>
    value.verdict ? `${name}: ${value.matched ? 'matched' : 'no'} (${value.confidence})` : `${name}: —`,
  )

  return result
}
