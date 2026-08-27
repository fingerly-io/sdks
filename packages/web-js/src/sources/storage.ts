/**
 * Storage availability, and the private-browsing probes built on it.
 *
 * There is no single incognito tell. Each engine closes the last leak and opens
 * a new one, so this runs a narrow probe per engine and reports each answer
 * separately - the verdict is assembled in `@badele/core`'s `detect/incognito`,
 * where the engine gate lives.
 *
 * That split is deliberate. `detectincognitojs` returns one boolean, which
 * throws away *which* engine's tell fired, and the engine is what makes the
 * verdict defensible when a customer asks why a user was challenged.
 */

import { SOURCE, UnsupportedSignal, type Source, type StorageSignal } from '@badele/core'

import { attempt, compact, requireWindow } from '../util.js'

/**
 * Whether a Web Storage area is actually usable.
 *
 * Presence is not enough: the object exists in a Safari private window and
 * throws `QuotaExceededError` on write, and it exists with cookies disabled
 * and throws `SecurityError` on access. Both are answered by writing.
 */
function storageWorks(area: 'localStorage' | 'sessionStorage'): boolean {
  try {
    const store = window[area]
    if (!store) return false
    const key = '__badele_probe__'
    store.setItem(key, '1')
    store.removeItem(key)
    return true
  } catch {
    return false
  }
}

function indexedDbWorks(): boolean {
  try {
    // Presence only. Actually opening a database is asynchronous, needs a
    // cleanup path, and in Firefox's private mode fires neither callback -
    // which would mean this source's answer depended on a timeout.
    return typeof window.indexedDB === 'object' && window.indexedDB !== null
  } catch {
    // Firefox in private mode used to throw on the *property access*, which is
    // itself the answer.
    return false
  }
}

/**
 * Safari's private-window tell.
 *
 * `navigator.storage.getDirectory()` rejects with a message naming an "unknown
 * transient reason" in a private window, and resolves in an ordinary one. The
 * message is matched rather than the error type because the type is the same
 * in both cases.
 */
async function safariPrivate(): Promise<boolean | undefined> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<unknown>
  }
  if (typeof storage?.getDirectory !== 'function') return undefined

  try {
    await storage.getDirectory()
    return false
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return message.includes('unknown transient reason')
  }
}

/**
 * Firefox's private-window tell: no service worker container.
 *
 * Reported raw. It is not conclusive on its own - an insecure context also has
 * none - which is exactly why the engine gate is applied in the detector rather
 * than here.
 */
function serviceWorkerAvailable(): boolean | undefined {
  if (!window.isSecureContext) return undefined
  return 'serviceWorker' in navigator
}

export const storageSource: Source<StorageSignal> = {
  id: SOURCE.storage,
  tier: 'fast',
  timeoutMs: 250,
  async run() {
    requireWindow()

    const quota = await attempt(async () => {
      if (typeof navigator.storage?.estimate !== 'function') return undefined
      const estimate = await navigator.storage.estimate()
      return estimate.quota
    })

    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory

    return compact<StorageSignal>({
      local_storage: storageWorks('localStorage'),
      session_storage: storageWorks('sessionStorage'),
      indexed_db: indexedDbWorks(),
      quota,
      // Chromium's incognito quota is derived from device memory on recent
      // builds rather than being a fixed number, so the ratio is the form of
      // the test that survives the next change to it. Reported alongside the
      // absolute value rather than instead, because older builds need the
      // absolute one.
      quota_ratio:
        typeof quota === 'number' && typeof deviceMemory === 'number' && deviceMemory > 0
          ? quota / (deviceMemory * 1024 * 1024 * 1024)
          : undefined,
      safari_private: await safariPrivate(),
      service_worker: serviceWorkerAvailable(),
    })
  },
}

/**
 * Whether the browser partitions third-party storage.
 *
 * Its own source rather than a field on the one above, because it describes
 * the browser's policy rather than this origin's storage: Safari and Firefox
 * partition, Chromium is part-way through the same migration, and which of
 * those a visitor is on narrows the browser considerably.
 *
 * Cookies are not reported here - `navigator.cookie_enabled` already carries
 * that, and a second reading of the same property in a second source would
 * just be two chances to disagree.
 */
export const storageQuotaSource: Source<{ partitioned: boolean }> = {
  id: SOURCE.storageQuota,
  tier: 'fast',
  run() {
    requireWindow()
    if (typeof document === 'undefined') throw new UnsupportedSignal('no-document')

    return { partitioned: typeof document.hasStorageAccess === 'function' }
  },
}
