/**
 * The contract a signal source implements, and the errors it uses to say what
 * went wrong.
 *
 * A source never returns a status itself. It returns a value, or it throws one
 * of the errors below, and the scheduler turns that into a [[SignalOutcome]].
 * Keeping the classification in one place is what stops fifty sources from
 * each inventing their own idea of "blocked".
 */

import type { SignalOutcome, SourceTier } from './types.js'

/** What a source is handed when it runs. */
export interface SourceContext {
  /**
   * Aborted when the source's own timeout expires or the whole budget does.
   * A source that awaits anything cancellable - a fetch, an event, a frame -
   * should pass this along, so that giving up actually releases the work
   * instead of leaving it running behind a resolved promise.
   */
  readonly signal: AbortSignal
  /** Milliseconds left in the overall budget, at the moment of the call. */
  budgetRemainingMs(): number
  /**
   * The outcome of a source that has already finished, if it has.
   *
   * Tiers are barriers, so a `deferred` source can rely on every `fast` one
   * having completed. A source must not look up a sibling in its own tier -
   * they run together and the answer would be a race.
   *
   * This exists mainly so that an expensive source can decide *not to run*:
   * canvas checks whether the fast tier already found resistFingerprinting
   * before it touches an API that would prompt the user under it.
   */
  completed(id: string): SignalOutcome | undefined
}

/**
 * One observation.
 *
 * `timeoutMs` is per source rather than global because the sources are wildly
 * uneven: reading `navigator.hardwareConcurrency` should never take 1ms, while
 * rendering an audio buffer legitimately takes tens. One number for both would
 * either strangle the slow sources or excuse the fast ones for hanging.
 *
 * # A source must never make the browser ask the user anything
 *
 * This is the hard rule of the whole collection layer, not a preference. Fraud
 * detection that interrupts a checkout with a permission dialog has destroyed
 * the thing it was protecting, and a visitor who is asked has been told they
 * are being measured.
 *
 * So: no `getUserMedia`, no `Notification.requestPermission`, no
 * `geolocation.getCurrentPosition`, no `DeviceMotionEvent.requestPermission`,
 * no `storage.persist`, no `requestStorageAccess`, no file/device pickers, no
 * `credentials.get`, no fullscreen or pointer-lock request. Reading a
 * permission's *state* is fine and prompts nobody - `permissions.query()` is
 * specified never to prompt, and `enumerateDevices()` returns unlabelled
 * devices rather than asking. Requesting is what is forbidden.
 *
 * The subtle cases are the ones that prompt only on some browsers.
 * `canvas.toDataURL()` is the important one: ordinary browsers answer silently,
 * but Tor Browser raises a doorhanger asking whether the site may read canvas
 * data. A source in that position must detect the condition and decline, which
 * is what [[SourceContext.completed]] is for.
 *
 * `tests/no-permission-prompts.test.ts` in `@fingerly/web-js` enforces the list.
 */
export interface Source<T = unknown> {
  readonly id: string
  readonly tier: SourceTier
  readonly timeoutMs?: number
  run(ctx: SourceContext): Promise<T> | T
}

/**
 * The API is not present.
 *
 * Thrown when a source finds nothing to measure - no `AudioContext` on this
 * browser, no `navigator.deviceMemory`. This is a fact about the device, and
 * the report keeps it as `unsupported` rather than as a hole.
 */
export class UnsupportedSignal extends Error {
  override readonly name = 'UnsupportedSignal'
  constructor(readonly reason?: string) {
    super(reason ?? 'unsupported')
  }
}

/**
 * The API is present and refused, or answered with deliberate noise.
 *
 * This is the status that is easiest to throw away. A `SecurityError` from canvas
 * readback, a suspended `AudioContext`, a permissions query that resolves to
 * `denied` without a prompt - each says the visitor is running a countermeasure,
 * and knowing *which* countermeasure is most of how Tor and hardened browsers
 * are identified. Being blocked is a measurement, not a failure to measure.
 */
export class BlockedSignal extends Error {
  override readonly name = 'BlockedSignal'
  constructor(readonly reason?: string) {
    super(reason ?? 'blocked')
  }
}

/** Raised by the scheduler, never by a source. Exported so callers can test it. */
export class TimedOutSignal extends Error {
  override readonly name = 'TimedOutSignal'
  constructor(readonly reason?: string) {
    super(reason ?? 'timeout')
  }
}

/**
 * Reduce a thrown value to the short stable token that goes on the wire.
 *
 * Deliberately not the message and never the stack. A message carries version
 * numbers and sometimes user data, and a stack changes between browser
 * releases - either would make the report unstable for exactly the visitors we
 * most want to match across sessions.
 */
export function reasonOf(error: unknown): string | undefined {
  if (
    error instanceof UnsupportedSignal ||
    error instanceof BlockedSignal ||
    error instanceof TimedOutSignal
  ) {
    // Their own `reason`, not their class name. `source-timeout` and
    // `budget-exhausted` are different facts and both arrive as a
    // TimedOutSignal, so falling through to the name below would erase the
    // distinction the scheduler went to the trouble of making.
    return error.reason
  }
  if (error instanceof Error && typeof error.name === 'string' && error.name !== 'Error') {
    return error.name
  }
  return undefined
}
