/**
 * The contract a signal source implements, and the errors it uses to say what
 * went wrong.
 *
 * A source never returns a status itself. It returns a value, or it throws one
 * of the errors below, and the scheduler turns that into a [[SignalOutcome]].
 */

import type { SignalOutcome, SourceStage } from './types.js'

export type { SourceStage }
export type SourceOptIn = 'extended-incognito'

/** What a source is handed when it runs. */
export interface SourceContext {
  /**
   * Aborted when the source's own timeout expires or the whole budget does.
   */
  readonly signal: AbortSignal
  /** Milliseconds left in the overall budget, at the moment of the call. */
  budgetRemainingMs(): number
  /**
   * The outcome of a source from an earlier stage (`prerequisite` -> `collect`),
   * if it has finished. Siblings within the same stage run concurrently and are
   * not exposed here so lookups cannot race.
   */
  completed(id: string): SignalOutcome | undefined
  /**
   * Per-run scratchpad shared across sources within one `collect()` pass (for
   * example, sharing one offscreen `<canvas>` 2D context between `shields` and
   * `canvas`). Optional so lightweight unit-test mocks do not have to supply it.
   */
  readonly shared?: Map<string, unknown>
}

/**
 * One observation.
 *
 * # Rule #1 — A source must never make the browser ask the user anything
 *
 * No `getUserMedia`, no `getDisplayMedia`, no `Notification.requestPermission`,
 * no `geolocation.getCurrentPosition`, no `DeviceMotionEvent.requestPermission()`,
 * no `storage.persist`, no `requestStorageAccess`, no file/device pickers, no
 * `credentials.get`, no `clipboard.read` / `clipboard.readText`, no
 * `queryLocalFonts`, and on Gecko engines no unguarded canvas/WebGL pixel
 * readbacks under `resistFingerprinting` timer clamping.
 */
export interface Source<T = unknown> {
  readonly id: string
  /**
   * Execution stage. `'prerequisite'` runs first as a barrier (`engine` and
   * Gecko RFP timer probe); `'collect'` (default) runs second.
   */
  readonly stage?: SourceStage
  /**
   * Opt-in gate. `'extended-incognito'` runs only when the caller explicitly
   * passes `incognitoDetection: 'extended'`.
   */
  readonly optIn?: SourceOptIn
  /**
   * Whether this source is non-identifying and permitted inside detected
   * embedded mobile WebViews under Apple DPLA §3.3.3(B).
   */
  readonly embeddedSafe?: boolean
  readonly timeoutMs?: number
  run(ctx: SourceContext): Promise<T> | T
}

/**
 * The API is not present.
 */
export class UnsupportedSignal extends Error {
  override readonly name = 'UnsupportedSignal'
  constructor(readonly reason?: string) {
    super(reason ?? 'unsupported')
  }
}

/**
 * The API is present and refused, suppressed to avoid a prompt, or answered
 * with deliberate noise.
 */
export class BlockedSignal extends Error {
  override readonly name = 'BlockedSignal'
  constructor(readonly reason?: string) {
    super(reason ?? 'blocked')
  }
}

/** Raised by the scheduler when a source or run exceeds its deadline. */
export class TimedOutSignal extends Error {
  override readonly name = 'TimedOutSignal'
  constructor(readonly reason?: string) {
    super(reason ?? 'timeout')
  }
}

/**
 * Reduce a thrown value to the short stable token that goes on the wire.
 */
export function reasonOf(error: unknown): string | undefined {
  if (
    error instanceof UnsupportedSignal ||
    error instanceof BlockedSignal ||
    error instanceof TimedOutSignal
  ) {
    return error.reason
  }
  if (error instanceof Error && typeof error.name === 'string' && error.name !== 'Error') {
    return error.name
  }
  return undefined
}
