/**
 * How long a durable IndexedDB commit takes, relative to a non-durable one.
 *
 * The Chromium private-window tell, after every value-based one was closed.
 * Chrome 152 pins the storage quota to `usage + 10 GiB` in both windows
 * specifically to stop this detection, and the APIs that used to refuse in an
 * incognito profile no longer do. What is left is not a value the browser
 * reports but a cost it cannot avoid paying, or avoid not paying.
 *
 * An incognito profile has no path to write to. `CreateLevelDBState` sees the
 * empty path and builds the store on `leveldb_chrome::NewMemEnv`, so the fsync
 * that `BackingStore::ShouldSyncOnCommit` issues for a `durability: 'strict'`
 * commit lands in memory and costs nothing. On disk that fsync is by far the
 * most expensive part of a small transaction. Two commits, same payload, same
 * store, differing only in the durability hint: equal in memory, unequal on
 * disk.
 *
 * The measurement is the *ratio* of the two, never either duration. A duration
 * measures the machine, and a threshold on one is a threshold on how fast the
 * visitor's phone is - which is how the previous generation of this idea came
 * to fire on cheap Android hardware. The ratio divides the machine out: a slow
 * device and a fast one disagree about everything here except that syncing
 * costs more than not syncing.
 *
 * Credit where it is due: the technique and the constants are Joe Rutkowski's,
 * from `detectIncognito` v1.8, calibrated there against eighteen real Android
 * devices. What is different here is that this reports the ratio and lets
 * `@fingerly/core` decide, rather than returning a boolean - so the threshold can
 * be re-cut server-side over stored reports when the next Chromium release
 * moves it, instead of waiting for every customer to ship a new SDK.
 *
 * The premise to re-check when it breaks: Chromium is migrating IndexedDB from
 * LevelDB to SQLite (`IdbSqliteBackingStore`, staged behind
 * `GetSqliteRolloutStage`). A SQLite backing store may not have the same
 * in-memory shortcut, and if it becomes the default this source will start
 * reporting ratios near 1 on disk as well. `honored` and `rounds` are reported
 * so that failure is visible in the data rather than silent in the verdict.
 */

import {
  SOURCE,
  UnsupportedSignal,
  type EngineSignal,
  type Source,
  type StorageDurabilitySignal,
} from '@fingerly/core'

import { compact, requireWindow } from '../util.js'

/**
 * The shape of one measurement, from `detectIncognito`'s calibration.
 *
 * 16KB is large enough that the commit is dominated by the sync rather than by
 * the fixed cost of a transaction, and small enough that fifteen of them are
 * affordable. The writes are sequential rather than batched because LevelDB
 * group-commit would otherwise amortise one fsync across the whole batch, which
 * is precisely the cost being measured.
 */
const PAYLOAD_BYTES = 16_384
const WRITES_PER_BLOCK = 15

/**
 * How many paired readings to take, and the fewest worth a median.
 *
 * A median rather than a mean because the distribution has a tail and the tail
 * is other tabs, not this one. Below `MIN_ROUNDS` the median is not a median,
 * and the source reports what it managed rather than pretending - the detector
 * has the floor.
 *
 * Nine rather than the fifteen this started with, and the reduction is measured
 * rather than guessed. The same four windows were sampled twice, once at nine
 * rounds and once at fifteen:
 *
 *   ordinary Chrome    3.778 / 3.86      ordinary Brave    3.062 / 3.17
 *   incognito Chrome   1.000 / 1.056     private Brave     0.962 / 1.043
 *
 * The two columns agree about every window, and not marginally - each pair sits
 * on the same side of the threshold with the whole of the gap to spare. The six
 * extra rounds bought no accuracy at all.
 *
 * They were not free, and the asymmetry is the point. A round costs almost
 * nothing in memory and roughly 15ms on disk, so the rounds this drops are
 * mostly rounds spent on visitors who are *not* browsing privately - the common
 * case, paying for the rare one. Measured on the collection as a whole: 248ms
 * to 154ms for an ordinary Chrome window, against 81ms either way for an
 * incognito one.
 */
const MAX_ROUNDS = 9
const MIN_ROUNDS = 5

/**
 * What the probe leaves for the rest of the deferred tier.
 *
 * This source is the most expensive one in the set and the only one that
 * writes. It stops early rather than spending the budget it is allowed, because
 * a report with a durability ratio and no fonts is a worse report than one with
 * both.
 */
const BUDGET_RESERVE_MS = 250
const CAP_MS = 600

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

/**
 * Whether the engine reflects the durability hint back.
 *
 * An engine that ignores it runs both halves of the ratio identically, which
 * reads as in-memory on every machine in the world. Checked before anything is
 * timed, because that failure is indistinguishable from the finding.
 */
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

/** Time a run of sequential single-put commits at one durability setting. */
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
  tier: 'deferred',
  // One round may overshoot the soft deadline; the slice has to cover that.
  timeoutMs: CAP_MS + 400,
  async run(ctx) {
    requireWindow()
    if (typeof indexedDB !== 'object' || indexedDB === null) {
      throw new UnsupportedSignal('no-indexeddb')
    }

    // Chromium only, and cheaply established: the fast tier has finished by the
    // time a deferred source runs, so the engine is already known. Everywhere
    // else this would be an expensive way to measure nothing - Firefox and
    // Safari private windows are caught by the file system they refuse, which
    // costs one call and no writes.
    const engine = ctx.completed(SOURCE.engine)
    const observed = engine?.status === 'ok' ? (engine.value as EngineSignal).observed : undefined
    if (observed !== 'chromium') throw new UnsupportedSignal('not-chromium')

    const name = `__fingerly_durability_${Math.random().toString(36).slice(2)}`
    const payload = new Uint8Array(PAYLOAD_BYTES)
    let db: IDBDatabase | undefined

    try {
      db = await openDatabase(name)

      if (!durabilityHonored(db)) return { honored: false }

      // Discarded. The first commits of a fresh store pay for the store, not
      // for the sync, and including them biases the first ratio downwards -
      // towards the in-memory answer, which is the direction that costs a
      // visitor a false positive.
      await timeBlock(db, 'relaxed', payload)
      await timeBlock(db, 'strict', payload)

      const started = performance.now()
      const deadline =
        started + Math.min(CAP_MS, Math.max(0, ctx.budgetRemainingMs() - BUDGET_RESERVE_MS))
      const ratios: number[] = []

      // The stopping rule has to look forwards, not backwards, and the reason
      // is the asymmetry this source is built on. In memory a round is nearly
      // free and all nine fit inside the budget with room to spare. On
      // disk a single round is two dozen fsyncs and can outlast the whole
      // deferred tier by itself - so a loop that checks the clock only after
      // the round it just paid for overshoots by exactly the amount that hurts.
      //
      // Which means the budget runs out mostly on the machines that are *not*
      // private, and running out is not a problem there: too few rounds makes
      // the detector abstain, and abstaining on an ordinary window is the right
      // answer reached the long way round.
      while (ratios.length < MAX_ROUNDS) {
        if (ctx.signal.aborted) break
        if (ratios.length > 0) {
          const perRound = (performance.now() - started) / ratios.length
          if (performance.now() + perRound > deadline) break
        }

        const relaxed = await timeBlock(db, 'relaxed', payload)
        const strict = await timeBlock(db, 'strict', payload)
        // A relaxed block too fast for the clock to resolve makes the ratio
        // meaningless rather than infinite. Dropped, not counted.
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
      // Always, on every path. This source is the only one that leaves anything
      // behind, and a database named after a random number accumulating on a
      // visitor's disk once per page load is not an acceptable cost of being
      // measured.
      try {
        db?.close()
        indexedDB.deleteDatabase(name)
      } catch {
        /* the profile is going away anyway, or was never ours to clean */
      }
    }
  },
}
