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
 */

import { SOURCE, valueOf, type EngineSignal, type StorageSignal } from '../signals.js'
import type { SignalReport, Verdict } from '../types.js'
import { unknown, weigh, type Evidence } from './verdict.js'

/**
 * Chromium's quota tells, and why there are two of them.
 *
 * A normal profile is offered a quota derived from free *disk*; an incognito
 * one is derived from physical *memory*. That difference is the tell, and the
 * shape it takes has moved twice.
 *
 * Historically incognito was capped at ~120MB, so "under a gigabyte" caught it.
 * That is no longer true and has not been for some time: measured on Chrome 151
 * with 16GB reported, an incognito window is offered 3GiB against the same
 * profile's ordinary 10GiB. The absolute test misses it by three gigabytes.
 *
 * What still separates them cleanly is the ratio to device memory - 0.1875
 * incognito against 0.625 ordinary, on the same machine minutes apart. The
 * ceiling below sits between the two with room on both sides rather than on
 * either observation, because the next change will move them again.
 *
 * The absolute test is kept for older builds, where it is the one that fires.
 * A profile that trips both is a profile two independent readings agree about.
 */
const CHROMIUM_INCOGNITO_QUOTA_CEILING = 1_073_741_824 // 1 GiB
const CHROMIUM_INCOGNITO_QUOTA_RATIO_CEILING = 0.3

export function detectIncognito(report: SignalReport): Verdict {
  const storage = valueOf<StorageSignal>(report, SOURCE.storage)
  const engine = valueOf<EngineSignal>(report, SOURCE.engine)

  if (!storage) return unknown()

  const evidence: Evidence[] = []
  const observed = engine?.observed

  // --- WebKit -------------------------------------------------------------
  // Safari's private windows reject `navigator.storage.getDirectory()` with a
  // message naming an "unknown transient reason". Decisive on its own: no
  // ordinary Safari window does this. `safari_private` is the same probe as
  // reported by SDKs before the outcome was reported raw.
  if (storage.origin_filesystem === 'transient' || storage.safari_private === true) {
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
  if (observed === 'gecko' && storage.origin_filesystem === 'refused') {
    evidence.push({ reason: 'firefox-private-origin-filesystem-refused', weight: 1.3 })
  }

  // The tell above replaced this one, which still fires on Firefox before 138
  // and on a profile set to never remember history. Kept at its old weight: on
  // the builds where it fires it is as good as it ever was, and on the builds
  // where it does not the value is `true` and this never runs.
  if (observed === 'gecko' && storage.service_worker === false) {
    evidence.push({ reason: 'firefox-no-service-worker-registration', weight: 1.2 })
  }

  // --- Chromium -----------------------------------------------------------
  if (observed === 'chromium') {
    if (typeof storage.quota === 'number' && storage.quota < CHROMIUM_INCOGNITO_QUOTA_CEILING) {
      evidence.push({ reason: 'chromium-storage-quota-capped', weight: 1.3 })
    }
    // Enough to fire on its own, because on a current build it is the only one
    // that fires at all. A threefold gap between the two windows on one machine
    // is not weak evidence, and weighting it as though it were is how this
    // detector came to report "no" from inside an incognito window.
    if (
      typeof storage.quota_ratio === 'number' &&
      storage.quota_ratio < CHROMIUM_INCOGNITO_QUOTA_RATIO_CEILING
    ) {
      evidence.push({ reason: 'chromium-storage-quota-ratio-capped', weight: 1.3 })
    }
  }

  // --- Any engine ---------------------------------------------------------
  // Storage that is present but refuses to hold anything. Weak by itself,
  // because enterprise policy and cookie-blocking extensions both do this to
  // ordinary windows; it earns its place only alongside one of the tells above.
  if (storage.local_storage === false && storage.session_storage === false) {
    evidence.push({ reason: 'web-storage-unavailable', weight: 0.4 })
  }

  if (storage.indexed_db === false) {
    evidence.push({ reason: 'indexeddb-unavailable', weight: 0.3 })
  }

  return weigh(evidence)
}
