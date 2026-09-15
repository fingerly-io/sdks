/**
 * Small helpers every collector needs.
 */

import { BlockedSignal, UnsupportedSignal } from '@fingerly/core'

/**
 * A version of `T` whose optional fields may be explicitly undefined.
 *
 * The workspace builds with `exactOptionalPropertyTypes`, which is what we
 * want on the wire - an absent field and a field set to undefined should not
 * be different things in a stored report - but it makes probe code miserable,
 * because a probe naturally produces `undefined` for the parts it could not
 * read. Collectors build a `Loose<T>` and hand it to [[compact]].
 */
export type Loose<T> = { [K in keyof T]?: T[K] | undefined }

/** Drop the keys whose value is undefined, so the wire form has no holes. */
export function compact<T extends object>(value: Loose<T>): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}

/**
 * Read something that might throw, and report undefined rather than failing.
 *
 * Used for the individual fields inside a source. A source that could read
 * eleven of twelve properties should report the eleven - on a browser that
 * removed one property of an API, partial is the normal case, and throwing the
 * other ten away would lose far more than the failure is worth.
 */
export function attempt<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch {
    return undefined
  }
}

/** The global, or undefined where there is not one. */
export function windowOrNull(): (Window & typeof globalThis) | undefined {
  return typeof window === 'undefined' ? undefined : window
}

/**
 * Assert a browser global exists, or say precisely why the source cannot run.
 *
 * The distinction between unsupported and blocked is made once, here, rather
 * than by each source inventing its own idea of it - see the note on
 * [[SignalStatus]].
 */
export function requireWindow(): Window & typeof globalThis {
  const w = windowOrNull()
  if (!w) throw new UnsupportedSignal('no-window')
  return w
}

/**
 * Classify a caught DOM exception.
 *
 * `SecurityError` and `NotAllowedError` mean a countermeasure or a permission
 * refused the read, which is a `blocked` - the status that is itself a
 * measurement. Anything else is left to the scheduler to record as an error.
 */
export function asBlockedIfRefused(error: unknown): never {
  if (error instanceof Error) {
    if (
      error.name === 'SecurityError' ||
      error.name === 'NotAllowedError' ||
      error.name === 'NotSupportedError'
    ) {
      throw new BlockedSignal(error.name)
    }
  }
  throw error
}

