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
import { own } from './own.js'
import type {
  AgentDetection,
  IncognitoDetection,
  SignalOutcome,
  SignalStatus,
  SourceStage,
} from './types.js'

/** Wall-clock millisecond source for budget accounting (immune to `performance.now` clamping/mocks). */
const clock: () => number = () => Date.now()

export const DEFAULT_BUDGET_MS = 350

/**
 * How long past the default budget an identity-critical source may still run.
 *
 * A browser that has just started answers its first audio render, voice list,
 * font measurement and decode queries slowly, and without them a device has
 * too few components to be identified: a Safari private window's profile
 * clears the server's floor by about a bit, so one missing family is enough.
 * A warm browser finishes the whole run in a few tens of milliseconds and
 * never reaches this. A cold or slow one waits for the answer instead of
 * sending a report that cannot be recognised, up to 2.5 s from the start of
 * the run, which bounds a source that never answers at all.
 */
export const DEFAULT_GRACE_MS = 2150

export interface ScheduleOptions {
  /**
   * Total wall-clock ceiling for the two-stage single-pass run. Defaults to `350`ms.
   */
  budgetMs?: number
  /**
   * How long past `budgetMs` an `identityCritical` source may still run.
   * Defaults to `DEFAULT_GRACE_MS` when `budgetMs` is left at its default and
   * to `0` when the caller sets `budgetMs`: a budget the caller chose is a
   * ceiling.
   *
   * With a grace period, an identity-critical source is not stopped by its own
   * `timeoutMs`: it runs until it answers or the grace period ends. Its
   * timeout describes how long it normally takes, and cutting it there is how
   * a cold browser ended up unidentifiable.
   */
  graceMs?: number
  /** Applied to any source that does not set its own `timeoutMs`. */
  defaultSourceTimeoutMs?: number
  /** Maximum number of sources in flight concurrently within one stage. */
  concurrency?: number
  /** Stages to execute in barrier order. Defaults to `['prerequisite', 'collect']`. */
  stages?: readonly SourceStage[]
  /** Controls opt-in extended incognito sources (`optIn: 'extended-incognito'`). */
  incognitoDetection?: IncognitoDetection
  /** Controls opt-in interaction sources (`optIn: 'agent-interaction'`). */
  agentDetection?: AgentDetection
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

/**
 * Every optional field of a source, read as an own property (`WEB-09`). A field
 * the source does not set is undefined here even when `Object.prototype` has
 * one of that name.
 */
interface NormalizedSource {
  readonly source: Source
  readonly id: string
  readonly stage: SourceStage
  readonly optIn: Source['optIn']
  readonly active: Source['active']
  readonly timeoutMs: number | undefined
  readonly critical: boolean
}

function normalizeSource(source: Source): NormalizedSource {
  const stage = own(source, 'stage')
  const timeoutMs = own(source, 'timeoutMs')
  const active = own(source, 'active')
  return {
    source,
    id: String(own(source, 'id')),
    stage: stage === 'prerequisite' ? 'prerequisite' : 'collect',
    optIn: own(source, 'optIn'),
    active: typeof active === 'function' ? active : undefined,
    timeoutMs: typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? timeoutMs : undefined,
    critical: own(source, 'identityCritical') === true,
  }
}

/** Whether a source's `active` check lets it run; one that throws does not. */
function isActive(source: NormalizedSource): boolean {
  if (source.active === undefined) return true
  try {
    return source.active.call(source.source) === true
  } catch {
    return false
  }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isEnabled(
  source: NormalizedSource,
  incognitoDetection: IncognitoDetection | undefined,
  agentDetection: AgentDetection | undefined,
  filter: ((source: Source) => boolean) | undefined,
): boolean {
  if (source.optIn === 'extended-incognito' && incognitoDetection !== 'extended') {
    return false
  }
  if (source.optIn === 'agent-interaction' && agentDetection !== 'interaction') {
    return false
  }
  if (typeof filter === 'function' && !filter(source.source)) {
    return false
  }
  return isActive(source)
}

async function runSource(
  normalized: NormalizedSource,
  deadline: number,
  /** For a source that sets no `timeoutMs`; `undefined` means only `deadline` stops it. */
  defaultTimeoutMs: number | undefined,
  outerSignal: AbortSignal | undefined,
  completed: Readonly<Record<string, SignalOutcome>>,
  shared: Map<string, unknown>,
): Promise<SignalOutcome> {
  const started = clock()
  const budgetLeft = deadline - started

  if (budgetLeft <= 0) {
    return { status: 'timeout', ms: 0, reason: 'budget-exhausted' }
  }

  const { source } = normalized
  const slice =
    defaultTimeoutMs === undefined
      ? budgetLeft
      : Math.min(normalized.timeoutMs ?? defaultTimeoutMs, budgetLeft)
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
  // Own properties only (`WEB-09`): a polluted `Object.prototype.budgetMs` or
  // `stages` must not change what runs.
  const chosenBudget = own(options, 'budgetMs')
  const budgetMs = finiteOr(chosenBudget, DEFAULTS.budgetMs)
  const budgetChosen = typeof chosenBudget === 'number' && Number.isFinite(chosenBudget)
  const graceMs = Math.max(0, finiteOr(own(options, 'graceMs'), budgetChosen ? 0 : DEFAULT_GRACE_MS))
  const defaultSourceTimeoutMs = finiteOr(
    own(options, 'defaultSourceTimeoutMs'),
    DEFAULTS.defaultSourceTimeoutMs,
  )
  const concurrency = Math.max(1, finiteOr(own(options, 'concurrency'), DEFAULTS.concurrency))
  const ownStages = own(options, 'stages')
  const stages = Array.isArray(ownStages) ? ownStages : ALL_STAGES
  const incognitoDetection = own(options, 'incognitoDetection')
  const agentDetection = own(options, 'agentDetection')
  const filter = own(options, 'filter')
  const signal = own(options, 'signal')

  const started = clock()
  const deadline = started + budgetMs
  const graceDeadline = deadline + graceMs
  const deadlineOf = (source: NormalizedSource) => (source.critical ? graceDeadline : deadline)
  const outcomes: Record<string, SignalOutcome> = {}
  const completed: Record<string, SignalOutcome> = { ...(own(options, 'completed') ?? {}) }
  const shared = new Map<string, unknown>()
  const normalized = sources.map(normalizeSource)

  let truncated = false

  for (const stage of stages) {
    // Identity-critical sources first, so a slow stage does not leave them
    // waiting in the queue until the budget is gone. Stable otherwise.
    const enabled = normalized.filter(
      (source) =>
        source.stage === stage && isEnabled(source, incognitoDetection, agentDetection, filter),
    )
    const queue = [...enabled.filter((s) => s.critical), ...enabled.filter((s) => !s.critical)]
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

        if (clock() >= deadlineOf(source) || signal?.aborted) {
          truncated = true
          stageOutcomes[source.id] = { status: 'timeout', ms: 0, reason: 'budget-exhausted' }
          continue
        }

        // Under a grace period an identity-critical source answers or meets the
        // end of it; its own timeout no longer applies.
        const outcome = await runSource(
          source,
          deadlineOf(source),
          source.critical && graceMs > 0 ? undefined : defaultSourceTimeoutMs,
          signal,
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
