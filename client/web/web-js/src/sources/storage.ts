/**
 * Storage availability, and the private-browsing probes built on it.
 *
 * There is no single incognito tell. Each engine closes the last leak and opens
 * a new one, so this runs a narrow probe per engine and reports each answer
 * separately - the verdict is assembled in `@fingerly/core`'s `detect/incognito`,
 * where the engine gate lives.
 *
 * That split is deliberate. `detectincognitojs` returns one boolean, which
 * throws away *which* engine's tell fired, and the engine is what makes the
 * verdict defensible when a customer asks why a user was challenged.
 */

import { SOURCE, UnsupportedSignal, type Source, type StorageSignal } from '@fingerly/core'

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
    const key = '__fingerly_probe__'
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
 * The origin private file system, which is where both remaining desktop
 * private-window tells now live.
 *
 * One call, three interesting answers:
 *
 *   - Safari's private windows reject it with a message naming an "unknown
 *     transient reason", where an ordinary Safari window resolves.
 *   - Firefox's private windows reject it with a `SecurityError`. OPFS is
 *     switched off in private browsing (Mozilla bug 1785125) and supporting it
 *     is still an open bug (1975760), which makes this the tell that replaced
 *     the ones Firefox has closed: IndexedDB works in private windows now, and
 *     service workers have since Firefox 138.
 *   - Anything else is a failure we can say nothing about.
 *
 * The outcome is reported raw and classified in the detector, because which
 * refusal means "private" depends on the engine and the engine is decided by
 * another source.
 */
function classifyFilesystemRefusal(error: unknown): 'transient' | 'refused' | 'failed' {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)

  // WebKit names the reason in the message rather than in the type, and the
  // type it uses is one an ordinary window can also produce.
  if (message.includes('unknown transient reason')) return 'transient'
  // Gecko uses the type. The wording is matched as well because it is stable
  // ("Security error") and survives a rejection that lost its prototype.
  if (name === 'SecurityError' || message.includes('Security error')) return 'refused'
  return 'failed'
}

/**
 * How long the probe is given before the rest of the source goes on without it.
 *
 * Its own deadline rather than the source's: opening the file system for the
 * first time on a cold profile can have to initialise the quota manager, and
 * this source also carries the quota and the web-storage answers. A slow open
 * should cost its own answer, not theirs. Both refusals are immediate, so the
 * private-window case never reaches this.
 */
const FILESYSTEM_PROBE_MS = 200

async function originFilesystem(): Promise<StorageSignal['origin_filesystem']> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<unknown>
  }
  // Absent in an insecure context, where `navigator.storage` is not exposed at
  // all. Undefined rather than a guess: nothing was measured.
  if (typeof storage?.getDirectory !== 'function') return undefined

  return Promise.race([
    storage.getDirectory().then(
      () => 'ok' as const,
      (error: unknown) => classifyFilesystemRefusal(error),
    ),
    new Promise<undefined>((resolve) => setTimeout(resolve, FILESYSTEM_PROBE_MS)),
  ])
}

/**
 * The deprecated quota API, read as a second opinion on the modern one.
 *
 * `navigator.storage.estimate()` used to be the whole Chromium private-window
 * tell, and on Brave it is now a constant: 2147483648 from every window on
 * every machine, because Brave pins the `StorageEstimate` binding that fills it
 * in. `webkitTemporaryStorage.queryUsageAndQuota` reaches the same quota
 * manager by an older road that the patch does not cover, and still answers
 * honestly - 10 GiB from an ordinary Brave window against 3 GiB from a private
 * one, measured on the same machine minutes apart.
 *
 * Callback-style, Chromium-only, deprecated, and one day it will be removed.
 * All three are fine: it is reported as its own field, so when it disappears
 * the field is absent and the detector goes back to what it did before, rather
 * than reading a missing value as a small one.
 */
const LEGACY_QUOTA_PROBE_MS = 150

interface DeprecatedStorageQuota {
  queryUsageAndQuota: (
    onSuccess: (usage: number, quota: number) => void,
    onError?: (error: unknown) => void,
  ) => void
}

function legacyQuota(): Promise<number | undefined> {
  const storage = (navigator as Navigator & { webkitTemporaryStorage?: DeprecatedStorageQuota })
    .webkitTemporaryStorage

  if (typeof storage?.queryUsageAndQuota !== 'function') return Promise.resolve(undefined)

  return new Promise<number | undefined>((resolve) => {
    // Settled once, whichever arrives first. The API is old enough to have
    // implementations that call neither callback, and this source carries four
    // other answers that should not wait on it.
    let settled = false
    const settle = (value: number | undefined) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    setTimeout(() => settle(undefined), LEGACY_QUOTA_PROBE_MS)
    try {
      storage.queryUsageAndQuota(
        (_usage, quota) => settle(typeof quota === 'number' ? quota : undefined),
        () => settle(undefined),
      )
    } catch {
      settle(undefined)
    }
  })
}

/**
 * Whether a service worker container is exposed.
 *
 * Firefox's old private-window tell, kept for the builds it still fires on -
 * Firefox 138 shipped service workers in private browsing and closed it there.
 * Not conclusive on its own even before that: an insecure context has no
 * container either, which is why that case reports nothing at all and why the
 * engine gate is applied in the detector rather than here.
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

    // All three started before any is awaited, because their deadlines are
    // concurrent and this source's is not the sum of them: 150ms for the legacy
    // quota and 200ms for the file system awaited in turn is 350ms against a
    // 250ms budget, which would have turned a source that answers into a source
    // that times out on a slow profile and reports nothing at all.
    const estimated = attempt(async () => {
      if (typeof navigator.storage?.estimate !== 'function') return undefined
      const estimate = await navigator.storage.estimate()
      return { quota: estimate.quota, usage: estimate.usage }
    })
    const legacy = legacyQuota()
    const filesystem = originFilesystem()

    const [estimate, legacyValue, originFilesystemValue] = await Promise.all([
      estimated,
      legacy,
      filesystem,
    ])
    const quota = estimate?.quota

    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory

    return compact<StorageSignal>({
      local_storage: storageWorks('localStorage'),
      session_storage: storageWorks('sessionStorage'),
      indexed_db: indexedDbWorks(),
      quota,
      usage: estimate?.usage,
      legacy_quota: legacyValue,
      // Chromium's incognito quota is derived from device memory on recent
      // builds rather than being a fixed number, so the ratio is the form of
      // the test that survives the next change to it. Reported alongside the
      // absolute value rather than instead, because older builds need the
      // absolute one.
      //
      // Both inputs are farbled on Brave, which is why the detector recomputes
      // this from the quota and the memory reading it decided to trust rather
      // than taking it. Kept because reports stored by shipped SDKs carry it
      // and the server's copy of the rules still has to read them.
      quota_ratio:
        typeof quota === 'number' && typeof deviceMemory === 'number' && deviceMemory > 0
          ? quota / (deviceMemory * 1024 * 1024 * 1024)
          : undefined,
      origin_filesystem: originFilesystemValue,
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
