/**
 * Private browsing detection.
 *
 * Per engine, because there is no shared tell. Each browser closes the classic
 * leaks and opens a new one, so this is a set of narrow probes with an explicit
 * engine gate on each rather than one clever trick - a trick that fires on the
 * wrong engine is a false positive on every ordinary visitor using it.
 *
 * The probes themselves run in `@badele/web-js`; this file only reads what they
 * reported. That split is what lets the same rules run again server-side over a
 * stored report, with better thresholds than the SDK shipped with.
 *
 * One rule cuts across all of them: a probe whose value the browser fabricates
 * is not evidence, however well it matches. Brave pins the storage quota to a
 * constant and randomises the device memory, and the Chromium branch below -
 * which divided one by the other - therefore reported every Brave visitor on
 * the web to be browsing privately, from an ordinary window. The gates in
 * `detect/shields` are what stop that, and every quota reading here passes
 * through one.
 */

import {
  SOURCE,
  valueOf,
  type EngineSignal,
  type StorageDurabilitySignal,
  type StorageSignal,
} from '../signals.js'
import type { SignalReport, Verdict } from '../types.js'
import {
  BRAVE_SYNTHETIC_QUOTA,
  CHROMIUM_STATIC_QUOTA,
  isStaticChromiumQuota,
  trustedDeviceMemory,
} from './shields.js'
import { unknown, weigh, type Evidence } from './verdict.js'

/**
 * Chromium's quota tells, and why there are two of them.
 *
 * A normal profile is offered a quota derived from free *disk*; an incognito
 * one is derived from physical *memory*. That difference is the tell, and the
 * shape it takes has moved twice.
 *
 * Historically incognito was capped at ~120MB, so "under a gigabyte" caught it.
 * Then the cap became a fraction of physical memory: Chrome 151 offered 3GiB
 * against the same profile's ordinary 10GiB on a 16GB machine, which the
 * absolute test misses by three gigabytes and the ratio catches at 0.1875
 * against 0.625.
 *
 * Then Chrome 152 closed it. `kIncognitoStaticStorageQuota` is on by default
 * and pins the incognito reading to the same `usage + 10 GiB` an ordinary
 * window gets; Chromium's comment on the flag says it is there "to avoid
 * fingerprinting and incognito detection". Both windows now report the same
 * number, and the tests below therefore find nothing on a current Chrome -
 * which is the honest outcome and not a bug to be worked around.
 *
 * All three are kept, because all three still fire somewhere: the absolute one
 * on builds old enough to have the ~120MB cap, the ratio on everything between
 * that and 152, and the static-pool comparison on Brave, which took the static
 * quota for ordinary windows without taking the incognito flag and so still
 * reports a memory-derived pool in a private one.
 *
 * The ratio ceiling is 0.25 rather than the 0.3 it was. Chromium sizes the
 * incognito pool at `kIncognitoQuotaRatioLowerBound` 0.15 to
 * `kIncognitoQuotaRatioUpperBound` 0.2 of physical memory, so 0.25 keeps a
 * quarter of headroom above the largest real pool while no longer reaching up
 * to the 0.29 an ordinary pre-static window produces on a nearly-full disk -
 * which was a false positive on every visitor whose laptop was full.
 */
const CHROMIUM_INCOGNITO_QUOTA_CEILING = 1_073_741_824 // 1 GiB
const CHROMIUM_INCOGNITO_QUOTA_RATIO_CEILING = 0.25

const BYTES_PER_GIB = 1_073_741_824

/**
 * Where a durable commit stops looking free.
 *
 * In memory the two durabilities are the same code path, so the ratio sits at
 * 1 and wanders with scheduler noise. On disk the strict commit pays for an
 * fsync the relaxed one skips, and the gap is large - large enough that 1.30
 * separates them with room on both sides rather than splitting the difference.
 * Joe Rutkowski's number, from calibrating `detectIncognito` against eighteen
 * real Android devices; there is no honest way to arrive at it from one Mac.
 *
 * The floor on rounds matters as much as the ceiling on the ratio. A median
 * over two readings is not a median, and the reports with too few readings are
 * the ones taken on a loaded machine where the noise is worst - which is
 * exactly where answering anyway turns a slow phone into a false positive.
 */
const CHROMIUM_DURABILITY_RATIO_CEILING = 1.3
const CHROMIUM_DURABILITY_MIN_ROUNDS = 5

/**
 * Which of the two quota readings to believe, if either.
 *
 * There are two because on Brave there are two answers. Brave pins
 * `navigator.storage.estimate().quota` to exactly 2 GiB - every window, every
 * machine, private and ordinary alike - specifically so that this detector
 * cannot work. It is not a cap and not noise: it is a constant, and a constant
 * carries no information about anything.
 *
 * The patch lands on the `StorageEstimate` binding. The deprecated
 * `webkitTemporaryStorage.queryUsageAndQuota` path reaches the same quota
 * manager without passing through it, and still answers honestly - 10 GiB from
 * an ordinary Brave window against 3 GiB from a private one on the same
 * machine, while `quota` said 2147483648 in both. So when the modern reading
 * is the constant, the legacy one is what is left, and when the legacy one is
 * absent - a non-Chromium browser, or the Chromium release that finally
 * removes the API - there is nothing to test and this returns nothing.
 *
 * Note the one case this gets wrong on purpose: a stock Chromium whose real
 * quota happens to land on 2147483648 exactly is treated as farbled and skips
 * the test. That is a missed private window roughly as often as a free disk
 * lands on a power of two to the byte, and the failure is a false negative,
 * which is the direction this file is willing to fail in.
 */
function trustedQuota(storage: StorageSignal): number | undefined {
  if (storage.quota !== BRAVE_SYNTHETIC_QUOTA) return storage.quota
  return storage.legacy_quota === BRAVE_SYNTHETIC_QUOTA ? undefined : storage.legacy_quota
}

export function detectIncognito(report: SignalReport): Verdict {
  const storage = valueOf<StorageSignal>(report, SOURCE.storage)
  const engine = valueOf<EngineSignal>(report, SOURCE.engine)
  const durability = valueOf<StorageDurabilitySignal>(report, SOURCE.storageDurability)

  // Nothing was measured that this file knows how to read. Note that it takes
  // *both* to be missing now: the durability probe is the only Chromium tell
  // left on a current build, and abstaining because a fast source failed would
  // throw away the answer on the strength of a signal that no longer has one.
  if (!storage && !durability) return unknown()

  const evidence: Evidence[] = []
  const observed = engine?.observed

  // --- WebKit -------------------------------------------------------------
  // Safari's private windows reject `navigator.storage.getDirectory()` with a
  // message naming an "unknown transient reason". Decisive on its own: no
  // ordinary Safari window does this. `safari_private` is the same probe as
  // reported by SDKs before the outcome was reported raw.
  if (storage?.origin_filesystem === 'transient' || storage?.safari_private === true) {
    evidence.push({ reason: 'safari-private-origin-filesystem-refused', weight: 1.4 })
  }

  // --- Gecko --------------------------------------------------------------
  // Firefox's remaining tell, and the reason there is only one.
  //
  // Every storage difference private browsing used to have has been closed:
  // IndexedDB works there, and service workers have since Firefox 138 (bug
  // 1320796) - which is what left this detector answering "no" from inside a
  // private window. What has not been closed is the origin private file
  // system: it is switched off in private browsing (bug 1785125) and turning
  // it on is still an open bug (1975760), so `getDirectory()` rejects with a
  // SecurityError there and resolves in an ordinary window.
  //
  // Gated on the engine, because a `SecurityError` from this call means
  // something else everywhere else - a Chromium frame denied storage access,
  // most obviously.
  if (observed === 'gecko' && storage?.origin_filesystem === 'refused') {
    evidence.push({ reason: 'firefox-private-origin-filesystem-refused', weight: 1.3 })
  }

  // The tell above replaced this one, which still fires on Firefox before 138
  // and on a profile set to never remember history. Kept at its old weight: on
  // the builds where it fires it is as good as it ever was, and on the builds
  // where it does not the value is `true` and this never runs.
  if (observed === 'gecko' && storage?.service_worker === false) {
    evidence.push({ reason: 'firefox-no-service-worker-registration', weight: 1.2 })
  }

  // --- Chromium -----------------------------------------------------------
  if (observed === 'chromium') {
    // The tell that outlived the quota, and the only one on a current Chrome.
    //
    // An incognito profile's IndexedDB is built on an in-memory LevelDB
    // environment, so the fsync a `durability: 'strict'` commit performs costs
    // nothing; on disk it is the most expensive part of the transaction. The
    // source reports the ratio of the two, which divides the machine out of the
    // answer - the thing an absolute duration could never do.
    //
    // Decisive on its own, because on Chrome 152 it is the only thing that
    // fires at all. Not enough for `high` alone, and deliberately so: this is a
    // timing measurement on a machine we do not control, and `high` is reserved
    // for the case where the quota agrees with it.
    if (
      durability?.honored === true &&
      typeof durability.ratio === 'number' &&
      typeof durability.rounds === 'number' &&
      durability.rounds >= CHROMIUM_DURABILITY_MIN_ROUNDS &&
      durability.ratio < CHROMIUM_DURABILITY_RATIO_CEILING
    ) {
      evidence.push({ reason: 'chromium-indexeddb-writes-are-not-durable', weight: 1.4 })
    }

    const quota = storage ? trustedQuota(storage) : undefined

    // Nothing below runs against Chromium's constant. It is the same number in
    // both windows by design, so every test built on it answers the same in
    // both - and below the constant the meaning inverts, because only an
    // ordinary window is still allowed a disk-derived figure. Reading a small
    // quota as private on a current build gets it exactly backwards.
    if (typeof quota === 'number' && !isStaticChromiumQuota(quota, storage?.usage)) {
      // The pinned modern reading with an unpinned legacy one behind it. This
      // is Brave, whose ordinary windows do report the constant through the
      // legacy path - measured at 10 GiB - because Brave carries the static
      // quota for normal mode and not the incognito flag that would pin the
      // other one. So a legacy reading that is not the constant did not come
      // from an ordinary window: it is the incognito pool, which Chromium sizes
      // at a fraction of physical memory. Measured at 3 GiB against the same
      // profile's ordinary 10 GiB.
      //
      // This is the tell that survives farbling, and it costs no device memory
      // to read - which is the whole reason it works where the ratio does not.
      if (
        storage?.quota === BRAVE_SYNTHETIC_QUOTA &&
        quota < CHROMIUM_STATIC_QUOTA
      ) {
        evidence.push({ reason: 'chromium-quota-below-static-pool', weight: 1.3 })
      }

      // The original absolute test, which still fires on builds old enough to
      // have capped incognito at ~120MB.
      if (quota < CHROMIUM_INCOGNITO_QUOTA_CEILING) {
        evidence.push({ reason: 'chromium-storage-quota-capped', weight: 1.3 })
      }

      // The pool as a fraction of physical memory, which is what a build
      // between the ~120MB cap and the static constant reports - Chrome 151
      // offered 3GiB against 16GB of memory, and an ordinary window 10GiB.
      //
      // Recomputed here rather than read from `storage.quota_ratio`, because
      // the SDK computed that field from two numbers Brave replaces. Both
      // halves have to be earned separately: `trustedQuota` rejects the pinned
      // 2 GiB, and `trustedDeviceMemory` rejects a denominator drawn from a
      // hat. When either is missing there is no ratio, and no ratio is the
      // correct answer - the alternative is the arithmetic that reported every
      // Brave visitor on the web to be browsing privately.
      const memory = trustedDeviceMemory(report)
      if (typeof memory === 'number') {
        const ratio = quota / (memory * BYTES_PER_GIB)
        if (ratio < CHROMIUM_INCOGNITO_QUOTA_RATIO_CEILING) {
          evidence.push({ reason: 'chromium-storage-quota-ratio-capped', weight: 1.3 })
        }
      }
    }
  }

  // --- Any engine ---------------------------------------------------------
  // Storage that is present but refuses to hold anything. Weak by itself,
  // because enterprise policy and cookie-blocking extensions both do this to
  // ordinary windows; it earns its place only alongside one of the tells above.
  if (storage?.local_storage === false && storage?.session_storage === false) {
    evidence.push({ reason: 'web-storage-unavailable', weight: 0.4 })
  }

  if (storage?.indexed_db === false) {
    evidence.push({ reason: 'indexeddb-unavailable', weight: 0.3 })
  }

  return weigh(evidence)
}
