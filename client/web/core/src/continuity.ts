/**
 * Session continuity, as the client sees it.
 *
 * By default a browser client keeps nothing on the device. A page that turns
 * `continuity: 'session'` on asks the server for a session seal with every
 * answer, and the client keeps the one seal it holds in `sessionStorage`, so
 * it lives exactly as long as the tab does. The seal is a signed statement of
 * the visitor the server already answered with; the client never looks inside
 * it and never makes one up.
 *
 * Every function here is total: storage that is missing, disabled or throwing
 * (a server render, a sandboxed frame, a browser that refuses storage) reads
 * as holding no seal, and a write or a removal that fails is dropped. Nothing
 * here can fail `identify()`.
 */

import { readSeal } from './transport.js'
import type { Continuity, SessionSeal } from './types.js'

const MODES: readonly Continuity[] = ['none', 'session']

/**
 * Refuse anything that is not one of the two modes.
 *
 * Loud rather than lenient, as consent is: a client that quietly read `true`
 * or `'tab'` as `session` would write to the visitor's storage on a page that
 * never asked for it, and one that read them as `none` would leave the page
 * without the continuity it believes it turned on.
 */
export function assertContinuity(mode: unknown): asserts mode is Continuity {
  if (!MODES.includes(mode as Continuity)) {
    throw new TypeError(
      `Fingerly continuity must be 'none' or 'session' (received ${JSON.stringify(mode)})`,
    )
  }
}

/** The one `sessionStorage` key a client with session continuity uses. */
export const SEAL_STORAGE_KEY = '__fingerly_seal__'

/** A held seal is sent only while it has at least this long left. */
export const SEAL_MARGIN_MS = 10_000

/** The longest stored value this SDK parses: a seal, an expiry and the JSON around them. */
const MAX_STORED_CHARS = 512

/** The part of `Storage` used here; this package compiles without the DOM types. */
interface SealStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** `sessionStorage`, or `undefined` where there is none or reading it throws. */
function sessionStore(): SealStore | undefined {
  try {
    const store = (globalThis as { sessionStorage?: SealStore | null }).sessionStorage
    return store === null || typeof store !== 'object' ? undefined : store
  } catch {
    return undefined
  }
}

/** Whether a seal still has more than [[SEAL_MARGIN_MS]] left. */
export function sealUsable(seal: SessionSeal): boolean {
  return Date.parse(seal.expires_at) - Date.now() > SEAL_MARGIN_MS
}

function parseStored(raw: string): SessionSeal | undefined {
  if (raw.length > MAX_STORED_CHARS) return undefined
  try {
    const seal = readSeal(JSON.parse(raw))
    return seal && sealUsable(seal) ? seal : undefined
  } catch {
    return undefined
  }
}

/**
 * The seal this tab holds, or `undefined`. A stored value that is not a seal,
 * or one that has expired, is removed.
 */
export function loadSeal(): string | undefined {
  const store = sessionStore()
  if (!store) return undefined
  try {
    const raw = store.getItem(SEAL_STORAGE_KEY)
    if (raw === null || raw === undefined) return undefined
    const seal = typeof raw === 'string' ? parseStored(raw) : undefined
    if (seal) return seal.seal
    store.removeItem(SEAL_STORAGE_KEY)
  } catch {
    // Storage that throws holds no seal.
  }
  return undefined
}

/** Keeps `seal` as the one seal this tab holds, replacing any other. */
export function storeSeal(seal: SessionSeal): void {
  const store = sessionStore()
  if (!store) return
  try {
    store.setItem(SEAL_STORAGE_KEY, JSON.stringify({ seal: seal.seal, expires_at: seal.expires_at }))
  } catch {
    // A full or refused store: the next report goes without a seal.
    clearSeal()
  }
}

/** Removes the seal this tab holds, if any. */
export function clearSeal(): void {
  const store = sessionStore()
  if (!store) return
  try {
    store.removeItem(SEAL_STORAGE_KEY)
  } catch {
    // Nothing to remove from a store that cannot be reached.
  }
}
