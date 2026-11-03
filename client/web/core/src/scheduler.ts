/**
 * The budgeted source runner.
 *
 * Every source runs under a deadline. Wrapping each source in a promise with
 * no timeout means a source that hangs hangs identification forever, and the
 * caller has no upper bound on how long identification takes. That is fine for an analytics beacon and not fine for
 * a login form, which is the difference this file is here to make.
 *
 * Three guarantees:
 *
 *  1. `collect` resolves within the budget, or very close to it. Not "usually".
 *  2. Every source appears in the result, whatever happened to it.
 *  3. No source can take another one down, or the run as a whole.
 *
 * # The limit of guarantee 1, stated honestly
 *
 * A `timeoutMs` is a target, not a promise, because it is enforced with
 * `setTimeout` and `setTimeout` is not reliable in the two cases that matter.
 *
 * **Background tabs.** Browsers throttle timers in a hidden tab. Measured in
 * Chrome, a bare `setTimeout(..., 100)` took 233ms on one call and 794ms on
 * another in the same session. A source with a 150ms timeout can therefore run
 * for the better part of a second, because the timer meant to stop it is
 * throttled by the same policy. Anything whose cost is *waiting* rather than
 * computing pays this; see the note in `sensorsSource` for what to do about it.
 *
 * **A blocked main thread.** `setTimeout` cannot preempt synchronous work, only
 * queue behind it. A source that blocks runs to completion whatever its timeout
 * says.
 *
 * The budget is the guarantee that survives both, because it is checked before
 * each source is started rather than relying on a timer to fire.
 *
 * The consequence for source authors: a `timeoutMs` must be short enough that
 * the *throttled* version of it is still affordable, a source should not wait
 * on a clock when it can avoid it, and a source that can block the thread for
 * an unbounded time does not belong in the set at any timeout.
 */

import {
  BlockedSignal,
  reasonOf,
  TimedOutSignal,
  UnsupportedSignal,
  type Source,
  type SourceContext,
} from './source.js'
import type { SignalOutcome, SignalStatus, SourceTier } from './types.js'

/** A monotonic clock where one exists, and a wall clock where it does not. */
const clock: () => number =
  typeof globalThis.performance?.now === 'function'
    ? () => globalThis.performance.now()
    : () => Date.now()

export interface ScheduleOptions {
  /**
   * The wall-clock ceiling for the whole run.
   *
   * The default is chosen to be survivable on a page that is doing something
   * else: a submission on a checkout button should not be the reason a click
   * feels slow. Sources that cannot fit belong in the `deferred` tier.
   */
  budgetMs?: number
  /** Applied to any source that does not set its own `timeoutMs`. */
  defaultSourceTimeoutMs?: number
  /**
   * How many sources may be in flight at once.
   *
   * Not unbounded: several of the browser sources contend for the main thread
   * (canvas, font measurement, anything that forces layout), and running all
   * of them together makes each one's duration a measure of the others rather
   * than of the device. A cap keeps the timings comparable between visits.
   */
  concurrency?: number
  /** Which tiers to run. Defaults to both. */
  tiers?: SourceTier[]
  /** Cancels the whole run from outside. */
  signal?: AbortSignal
  /** Outcomes from an earlier phase, visible through SourceContext but not returned. */
  completed?: Readonly<Record<string, SignalOutcome>>
}

export interface ScheduleResult {
  outcomes: Record<string, SignalOutcome>
  elapsedMs: number
  /** True when the budget expired with sources still unfinished or unstarted. */
  truncated: boolean
}

const DEFAULTS = {
  budgetMs: 1200,
  defaultSourceTimeoutMs: 300,
  concurrency: 6,
} as const

/**
 * Durations are rounded to a whole millisecond before they leave this file.
 *
 * `performance.now()` offers sub-microsecond resolution in a secure context,
 * and shipping that would hand anyone reading the report a high-precision
 * timer oracle for the visitor's machine - and would make every report differ
 * from every other in the noise, which is the opposite of what a stable
 * fingerprint needs. Whole milliseconds carry the signal without the jitter.
 */
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
 * Run one source under its own timeout and the run's deadline, whichever comes
 * first, and translate whatever happens into an outcome.
 *
 * This function does not throw. That is the point of it: a source is untrusted
 * code as far as the scheduler is concerned - much of it pokes at browser APIs
 * specifically to see how they misbehave - and one that throws synchronously,
 * returns a rejected promise, or never settles at all must all end the same way.
 */
async function runSource(
  source: Source,
  deadline: number,
  defaultTimeoutMs: number,
  outerSignal: AbortSignal | undefined,
  completed: Readonly<Record<string, SignalOutcome>>,
): Promise<SignalOutcome> {
  const started = clock()
  const budgetLeft = deadline - started

  // Already out of time. Recorded as a timeout that cost nothing, rather than
  // omitted: "we never got to this" is a different fact from "this failed",
  // and a report full of zero-millisecond timeouts is a legible symptom.
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
  }

  try {
    const value = await Promise.race([
      // `Promise.resolve` rather than `await source.run(ctx)` so that a source
      // throwing synchronously is caught by this same try, on the same path as
      // one that rejects. A source author should never have to know which of
      // the two they wrote.
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
    // Building the object conditionally: `exactOptionalPropertyTypes` is on, so
    // `reason: undefined` is not the same as an absent `reason`, and an absent
    // one is what should reach the server.
    return reason === undefined
      ? { status, ms: roundMs(clock() - started) }
      : { status, ms: roundMs(clock() - started), reason }
  } finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', abortOuter)
  }
}

/**
 * Collect every source, tier by tier, inside the budget.
 *
 * Each tier is a barrier: every `fast` source has finished before the first
 * `deferred` one starts. That is not just ordering - it is what makes
 * [[SourceContext.completed]] dependable, and a deferred source needs it.
 *
 * The motivating case is canvas. Reading pixels back triggers a *permission
 * doorhanger* in Tor Browser, and this SDK must never make a browser ask its
 * user anything. Whether resistFingerprinting is active is established by the
 * `timing` source in the fast tier, so canvas - deferred - can look for Tor's
 * measured coarse clock profiles and decline to touch the API at all. Without
 * the barrier that lookup would be a race, and losing the race means prompting
 * a user.
 *
 * The barrier is affordable because the tiers are defined by cost: the fast
 * tier is cheap reads, measured at well under 30ms in total, so gating on its
 * slowest member costs almost nothing.
 *
 * When the budget runs out the remaining sources are not started - they are
 * recorded as budget-exhausted timeouts, which keeps the source set in the
 * report constant regardless of how the run went. A report whose *keys* vary
 * with load would be a fingerprint of the load.
 */
export async function collect(
  sources: readonly Source[],
  options: ScheduleOptions = {},
): Promise<ScheduleResult> {
  const budgetMs = options.budgetMs ?? DEFAULTS.budgetMs
  const defaultSourceTimeoutMs = options.defaultSourceTimeoutMs ?? DEFAULTS.defaultSourceTimeoutMs
  const concurrency = Math.max(1, options.concurrency ?? DEFAULTS.concurrency)
  const tiers: SourceTier[] = options.tiers ?? ['fast', 'deferred']

  const started = clock()
  const deadline = started + budgetMs
  const outcomes: Record<string, SignalOutcome> = {}
  const completed: Record<string, SignalOutcome> = { ...(options.completed ?? {}) }

  let truncated = false

  // One tier at a time, awaiting each before the next begins. See the note
  // above for why the barrier is worth its cost.
  for (const tier of tiers) {
    const queue = sources.filter((source) => source.tier === tier)
    if (queue.length === 0) continue

    let next = 0

    const worker = async (): Promise<void> => {
      while (next < queue.length) {
        const source = queue[next++]
        if (!source) continue

        if (clock() >= deadline || options.signal?.aborted) {
          truncated = true
          outcomes[source.id] = { status: 'timeout', ms: 0, reason: 'budget-exhausted' }
          continue
        }

        const outcome = await runSource(
          source,
          deadline,
          defaultSourceTimeoutMs,
          options.signal,
          // The outcomes so far. Everything from earlier tiers is complete;
          // sources within a tier run together, so a source must not depend on
          // a sibling in its own tier.
          completed,
        )
        if (outcome.status === 'timeout') truncated = true
        outcomes[source.id] = outcome
        completed[source.id] = outcome
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  }

  return { outcomes, elapsedMs: roundMs(clock() - started), truncated }
}
