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
 * Chromium's quota tell.
 *
 * A normal profile is offered a quota derived from free disk space, which is
 * measured in gigabytes. An incognito profile is capped - historically at
 * ~120MB, and on newer builds at a fraction of device memory. The absolute
 * number has moved several times, so the test is an order-of-magnitude one:
 * anything under a gigabyte on a desktop-class device is not a normal profile.
 *
 * Kept as a threshold rather than an equality for exactly that reason. Every
 * implementation that hard-coded 120MB broke when Chrome changed it.
 */
const CHROMIUM_INCOGNITO_QUOTA_CEILING = 1_073_741_824 // 1 GiB

export function detectIncognito(report: SignalReport): Verdict {
  const storage = valueOf<StorageSignal>(report, SOURCE.storage)
  const engine = valueOf<EngineSignal>(report, SOURCE.engine)

  if (!storage) return unknown()

  const evidence: Evidence[] = []
  const observed = engine?.observed

  // --- WebKit -------------------------------------------------------------
  // Safari's private windows reject `navigator.storage.getDirectory()` with a
  // message naming an "unknown transient reason". Decisive on its own: no
  // ordinary Safari window does this.
  if (storage.safari_private === true) {
    evidence.push({ reason: 'safari-private-origin-filesystem-refused', weight: 1.4 })
  }

  // --- Gecko --------------------------------------------------------------
  // Firefox private windows expose no service worker registration. Gated on
  // the engine because plenty of ordinary browsers lack one for other reasons -
  // an insecure context, most obviously, which is why the gate matters.
  if (observed === 'gecko' && storage.service_worker === false) {
    evidence.push({ reason: 'firefox-no-service-worker-registration', weight: 1.2 })
  }

  // --- Chromium -----------------------------------------------------------
  if (observed === 'chromium' && typeof storage.quota === 'number') {
    if (storage.quota < CHROMIUM_INCOGNITO_QUOTA_CEILING) {
      evidence.push({ reason: 'chromium-storage-quota-capped', weight: 1.3 })
    }
    // The ratio is the sharper form of the same test on newer builds, where the
    // incognito cap is derived from device memory rather than fixed. Added on
    // top rather than instead, so the two agreeing reads as stronger evidence.
    if (typeof storage.quota_ratio === 'number' && storage.quota_ratio < 0.1) {
      evidence.push({ reason: 'chromium-storage-quota-ratio-low', weight: 0.5 })
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
