/**
 * The budgeted single-pass two-stage source runner.
 *
 * Stage 1 (`'prerequisite'`) runs to completion as a barrier before Stage 2
 * (`'collect'`) starts, passing Stage 1 outcomes (`engine` + Gecko RFP timer
 * probe) and a per-run shared scratchpad into Stage 2 so `shields` and `canvas`
 * never race the Gecko timer gate.
 */

import {
  BlockedSignal,
  reasonOf,
  TimedOutSignal,
  UnsupportedSignal,
  type Source,
  type SourceContext,
} from './source.js'
import type { IncognitoDetection, SignalOutcome, SignalStatus, SourceStage } from './types.js'

/** Wall-clock millisecond source for budget accounting (immune to `performance.now` clamping/mocks). */
const clock: () => number = () => Date.now()

export const DEFAULT_BUDGET_MS = 350

export interface ScheduleOptions {
  /**
   * Total wall-clock ceiling for the two-stage single-pass run. Defaults to `350`ms.
   */
  budgetMs?: number
  /** Applied to any source that does not set its own `timeoutMs`. */
  defaultSourceTimeoutMs?: number
  /** Maximum number of sources in flight concurrently within one stage. */
  concurrency?: number
  /** Stages to execute in barrier order. Defaults to `['prerequisite', 'collect']`. */
  stages?: readonly SourceStage[]
  /** Controls opt-in extended incognito sources (`optIn: 'extended-incognito'`). */
  incognitoDetection?: IncognitoDetection
  /** Optional predicate to select a source subset (e.g. DPLA-safe embedded subset). */
  filter?: (source: Source) => boolean
  /** Cancels the whole run from outside. */
  signal?: AbortSignal
  /** Pre-populated outcomes visible through `SourceContext.completed`. */
  completed?: Readonly<Record<string, SignalOutcome>>
}

export interface ScheduleResult {
  outcomes: Record<string, SignalOutcome>
  elapsedMs: number
  /** True when the budget expired or a source timed out. */
  truncated: boolean
}

const DEFAULTS = {
  budgetMs: DEFAULT_BUDGET_MS,
  defaultSourceTimeoutMs: 250,
  concurrency: 6,
} as const

const ALL_STAGES: readonly SourceStage[] = ['prerequisite', 'collect']

function roundMs(ms: number): number {
  return Math.max(0, Math.round(ms))
}

function statusFor(error: unknown): SignalStatus {
  if (error instanceof UnsupportedSignal) return 'unsupported'
  if (error instanceof BlockedSignal) return 'blocked'
  if (error instanceof TimedOutSignal) return 'timeout'
  return 'error'
}

function isEnabled(source: Source, options: ScheduleOptions): boolean {
  if (source.optIn === 'extended-incognito' && options.incognitoDetection !== 'extended') {
    return false
  }
  if (options.filter && !options.filter(source)) {
    return false
  }
  return true
}

async function runSource(
  source: Source,
  deadline: number,
  defaultTimeoutMs: number,
  outerSignal: AbortSignal | undefined,
  completed: Readonly<Record<string, SignalOutcome>>,
  shared: Map<string, unknown>,
): Promise<SignalOutcome> {
  const started = clock()
  const budgetLeft = deadline - started

  if (budgetLeft <= 0) {
    return { status: 'timeout', ms: 0, reason: 'budget-exhausted' }
  }

  const slice = Math.min(source.timeoutMs ?? defaultTimeoutMs, budgetLeft)
  const controller = new AbortController()

  const abortOuter = () => controller.abort(new TimedOutSignal('aborted'))
  outerSignal?.addEventListener('abort', abortOuter, { once: true })

  const timer = setTimeout(() => controller.abort(new TimedOutSignal('source-timeout')), slice)

  const ctx: SourceContext = {
    signal: controller.signal,
    budgetRemainingMs: () => Math.max(0, deadline - clock()),
    completed: (id) => completed[id],
    shared,
  }

  try {
    const value = await Promise.race([
      (async () => source.run(ctx))(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(controller.signal.reason ?? new TimedOutSignal('source-timeout')),
          { once: true },
        )
      }),
    ])

    return { status: 'ok', ms: roundMs(clock() - started), value }
  } catch (error) {
    const status = statusFor(error)
    const reason = reasonOf(error)
    return reason === undefined
      ? { status, ms: roundMs(clock() - started) }
      : { status, ms: roundMs(clock() - started), reason }
  } finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', abortOuter)
  }
}

/**
 * Collect every enabled source across `prerequisite` -> `collect` inside `budgetMs`.
 */
export async function collect(
  sources: readonly Source[],
  options: ScheduleOptions = {},
): Promise<ScheduleResult> {
  const budgetMs = options.budgetMs ?? DEFAULTS.budgetMs
  const defaultSourceTimeoutMs = options.defaultSourceTimeoutMs ?? DEFAULTS.defaultSourceTimeoutMs
  const concurrency = Math.max(1, options.concurrency ?? DEFAULTS.concurrency)
  const stages = options.stages ?? ALL_STAGES

  const started = clock()
  const deadline = started + budgetMs
  const outcomes: Record<string, SignalOutcome> = {}
  const completed: Record<string, SignalOutcome> = { ...(options.completed ?? {}) }
  const shared = new Map<string, unknown>()

  let truncated = false

  for (const stage of stages) {
    const queue = sources.filter(
      (source) => (source.stage ?? 'collect') === stage && isEnabled(source, options),
    )
    if (queue.length === 0) continue

    // Snapshot completed outcomes before starting this stage so siblings in the
    // same stage never race on each other, while Stage 2 sees all of Stage 1.
    const stageSnapshot: Readonly<Record<string, SignalOutcome>> = { ...completed }
    const stageOutcomes: Record<string, SignalOutcome> = {}
    let next = 0

    const worker = async (): Promise<void> => {
      while (next < queue.length) {
        const source = queue[next++]
        if (!source) continue

        if (clock() >= deadline || options.signal?.aborted) {
          truncated = true
          stageOutcomes[source.id] = { status: 'timeout', ms: 0, reason: 'budget-exhausted' }
          continue
        }

        const outcome = await runSource(
          source,
          deadline,
          defaultSourceTimeoutMs,
          options.signal,
          stageSnapshot,
          shared,
        )
        if (outcome.status === 'timeout') truncated = true
        stageOutcomes[source.id] = outcome
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
    Object.assign(outcomes, stageOutcomes)
    Object.assign(completed, stageOutcomes)
  }

  return { outcomes, elapsedMs: roundMs(clock() - started), truncated }
}
