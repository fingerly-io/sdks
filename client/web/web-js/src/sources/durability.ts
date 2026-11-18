/**
 * Opt-in Chromium IndexedDB durability probe (`incognitoDetection === 'extended'`).
 *
 * An incognito profile keeps IndexedDB in memory, so a `durability: 'strict'`
 * commit costs what a `'relaxed'` one does; on disk the strict commit pays for
 * an fsync. The probe reports the median ratio of a strict block to a relaxed
 * one, which is about 1 in an incognito window and well above 1.3 in an
 * ordinary one (Chrome 157 on one Mac: 1.04 and 2.60). A ratio measures the
 * storage, not the machine, so it holds on slow hardware.
 *
 * The parameters are the ones the probe was calibrated with: 16 KB writes,
 * 15 per block, at least 7 and at most 15 rounds, a soft cap of one second.
 * That is too long to run inside `identify()`, so the probe starts as soon as
 * collection is permitted on a page that asked for it ([startDurabilityProbe])
 * and the source reports its result when `identify()` runs. A page that calls
 * `identify()` straight after `load()` waits for the probe within the
 * collection budget and its grace period: a fresh private window took longer
 * than the 200 ms this used to wait, so the first identification of a visit
 * missed it and only a second one found it.
 *
 * In an ordinary window the probe writes a few megabytes to disk once per
 * page, which is why it runs only for callers who opt in.
 */

import {
  SOURCE,
  UnsupportedSignal,
  type EngineSignal,
  type Source,
  type StorageDurabilitySignal,
} from '@fingerly/core'

import { compact, requireWindow } from '../util.js'

const PAYLOAD_BYTES = 16_384
const WRITES_PER_BLOCK = 15
const MAX_ROUNDS = 15
const MIN_ROUNDS = 7
const CAP_MS = 1000

interface DurableTransactionOptions {
  durability?: 'default' | 'strict' | 'relaxed'
}

type OpenDatabase = (name: string, version?: number) => IDBOpenDBRequest

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = (indexedDB.open as OpenDatabase)(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('s')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'))
    request.onblocked = () => reject(new Error('indexeddb-open-blocked'))
  })
}

function durabilityHonored(db: IDBDatabase): boolean {
  try {
    const transaction = db.transaction('s', 'readwrite', {
      durability: 'strict',
    } as DurableTransactionOptions) as IDBTransaction & { durability?: string }
    const honored = transaction.durability === 'strict'
    transaction.abort()
    return honored
  } catch {
    return false
  }
}

function timeBlock(
  db: IDBDatabase,
  durability: 'strict' | 'relaxed',
  payload: Uint8Array,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    let written = 0

    const step = (): void => {
      if (written === WRITES_PER_BLOCK) {
        resolve(performance.now() - started)
        return
      }
      const transaction = db.transaction('s', 'readwrite', {
        durability,
      } as DurableTransactionOptions)
      transaction.objectStore('s').put(payload, written)
      written += 1
      transaction.oncomplete = step
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error('indexeddb-write-failed'))
    }

    step()
  })
}

async function measureDurability(): Promise<StorageDurabilitySignal> {
  const name = `__fingerly_durability_${Math.random().toString(36).slice(2)}`
  const payload = new Uint8Array(PAYLOAD_BYTES)
  let db: IDBDatabase | undefined

  try {
    const started = performance.now()
    db = await openDatabase(name)
    if (!durabilityHonored(db)) return { honored: false }

    const ratios: number[] = []
    while (ratios.length < MAX_ROUNDS) {
      if (ratios.length >= MIN_ROUNDS && performance.now() - started > CAP_MS) break
      const relaxed = await timeBlock(db, 'relaxed', payload)
      const strict = await timeBlock(db, 'strict', payload)
      if (relaxed > 0) ratios.push(strict / relaxed)
      else break
    }

    if (ratios.length === 0) return { honored: true, rounds: 0 }

    ratios.sort((a, b) => a - b)
    return compact<StorageDurabilitySignal>({
      ratio: ratios[ratios.length >> 1],
      rounds: ratios.length,
      honored: true,
    })
  } finally {
    try {
      db?.close()
      indexedDB.deleteDatabase(name)
    } catch {
      /* ignore cleanup errors in ephemeral profiles */
    }
  }
}

/** The page's one measurement, started early or by the first `identify()`. */
let measurement: Promise<StorageDurabilitySignal> | undefined

/** Whether this looks like a Chromium page, the only engine the probe serves. */
function looksChromium(): boolean {
  return typeof (globalThis as { chrome?: unknown }).chrome === 'object'
}

function measurementOnce(): Promise<StorageDurabilitySignal> {
  if (!measurement) {
    measurement = measureDurability()
    // A failure is the source's to report, not an unhandled rejection.
    measurement.catch(() => undefined)
  }
  return measurement
}

/**
 * Starts the probe on a Chromium page whose caller opted into extended
 * incognito detection. Reads only after consent.
 */
export function startDurabilityProbe(): void {
  if (typeof indexedDB !== 'object' || indexedDB === null || !looksChromium()) return
  void measurementOnce()
}

export const storageDurabilitySource: Source<StorageDurabilitySignal> = {
  id: SOURCE.storageDurability,
  stage: 'collect',
  optIn: 'extended-incognito',
  // The caller asked for this answer, so identify() waits for a probe still
  // running, into the grace period after the default budget. The probe takes
  // about 100 ms in a private window and about 350 ms in an ordinary one; a
  // page that calls identify() later finds it ready and waits not at all.
  identityCritical: true,
  timeoutMs: 750,
  async run(ctx) {
    requireWindow()
    if (typeof indexedDB !== 'object' || indexedDB === null) {
      throw new UnsupportedSignal('no-indexeddb')
    }

    const engine = ctx.completed(SOURCE.engine)
    const observed = engine?.status === 'ok' ? (engine.value as EngineSignal).observed : undefined
    if (observed !== 'chromium') throw new UnsupportedSignal('not-chromium')

    return measurementOnce()
  },
}
