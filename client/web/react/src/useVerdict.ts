'use client'

/**
 * `useVerdict()` - one verdict, and the confidence floor it has to clear.
 *
 * Deprecated: read `suspectLevel` and `triggers` from `useIdentify()`. This is
 * derived from the server's triggers, for one transition version, and decides
 * nothing of its own.
 */

import { warnDeprecated, type Confidence, type Verdict, type Verdicts } from '@fingerly/web-js'
import { useDebugValue, useMemo, useSyncExternalStore } from 'react'

import { useFingerly } from './useFingerly.js'

export type VerdictName = keyof Verdicts

export interface UseVerdictReturn {
  /**
   * True when the server's trigger fired and met the confidence floor, false
   * when the server answered without it. `null` when no server has answered,
   * which is not a clean result.
   */
  matched: boolean | null
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
 * @deprecated Read `suspectLevel` and `triggers` from `useIdentify()`.
 *
 * Watch one verdict, derived from the server's triggers.
 *
 * ```tsx
 * const { matched, reasons } = useVerdict('automation', { min: 'high' })
 * ```
 *
 * `min` defaults to `medium`. Pass `min: 'low'` deliberately if the intent is
 * to observe rather than to block.
 */
export function useVerdict(
  name: VerdictName,
  options: { min?: Confidence } = {},
): UseVerdictReturn {
  warnDeprecated('useVerdict', 'read suspectLevel and triggers from useIdentify() instead.')
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
      // Null when the server has not answered, which is the difference between
      // "the server looked and found nothing" and "nobody looked".
      matched:
        !verdict || verdict.value === null
          ? null
          : verdict.value === true && RANK[verdict.confidence] >= RANK[min],
    }
  }, [verdicts, name, min])

  useDebugValue(result, (value) =>
    value.verdict ? `${name}: ${value.matched === null ? '—' : value.matched ? 'matched' : 'no'} (${value.confidence})` : `${name}: —`,
  )

  return result
}
