/**
 * Opt-in Chromium IndexedDB durability probe (`incognitoDetection === 'extended'`).
 *
 * Capped at `4` writes per block × `5` rounds (`<= 150ms`), run alongside the
 * other sources inside the single-pass `350ms` collection budget. The server
 * reads the median ratio of at least three rounds; fewer rounds are reported
 * as they are and decide nothing.
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
const WRITES_PER_BLOCK = 4
const MAX_ROUNDS = 5
const CAP_MS = 150

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

export const storageDurabilitySource: Source<StorageDurabilitySignal> = {
  id: SOURCE.storageDurability,
  stage: 'collect',
  optIn: 'extended-incognito',
  timeoutMs: 180,
  async run(ctx) {
    requireWindow()
    if (typeof indexedDB !== 'object' || indexedDB === null) {
      throw new UnsupportedSignal('no-indexeddb')
    }

    const engine = ctx.completed(SOURCE.engine)
    const observed = engine?.status === 'ok' ? (engine.value as EngineSignal).observed : undefined
    if (observed !== 'chromium') throw new UnsupportedSignal('not-chromium')

    const name = `__fingerly_durability_${Math.random().toString(36).slice(2)}`
    const payload = new Uint8Array(PAYLOAD_BYTES)
    let db: IDBDatabase | undefined

    try {
      const started = performance.now()
      const deadline = started + Math.min(CAP_MS, Math.max(0, ctx.budgetRemainingMs()))

      db = await openDatabase(name)
      if (!durabilityHonored(db)) return { honored: false }

      const ratios: number[] = []
      while (ratios.length < MAX_ROUNDS) {
        if (ctx.signal.aborted || performance.now() >= deadline) break
        if (ratios.length > 0) {
          const perRound = (performance.now() - started) / ratios.length
          if (performance.now() + perRound > deadline) break
        }

        const relaxed = await timeBlock(db, 'relaxed', payload)
        if (ctx.signal.aborted || performance.now() >= deadline) break
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
  },
}
