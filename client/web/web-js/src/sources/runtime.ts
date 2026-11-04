/**
 * How the runtime itself behaves: clock precision, permissions, and the direct
 * automation tells.
 *
 * The clock probe is the most valuable thing in this file. `performance.now()`
 * resolution is clamped by policy rather than by hardware, and the clamps are
 * distinctive: Tor and Firefox's resistFingerprinting round to 100ms, ordinary
 * Firefox to 1ms, Safari to 1ms, Chromium to 5µs (100µs when cross-origin
 * isolated). A resolution of 100ms is not a slow machine - it is a setting, and
 * it is the strongest single Tor tell available to a page.
 */

import {
  SOURCE,
  UnsupportedSignal,
  type AutomationSignal,
  type PermissionsSignal,
  type Source,
  type TimingSignal,
} from '@fingerly/core'

import { attempt, compact, requireWindow } from '../util.js'

/**
 * The smallest non-zero gap between two consecutive `now()` readings.
 *
 * Sampled in a tight loop rather than timed against anything, because the
 * quantity wanted is the granularity of the clock and not the speed of the
 * machine. A busy loop is the only way to see the granularity: two calls close
 * enough together return the same value until the clock ticks.
 */
function clockResolution(now: () => number): number | undefined {
  const deltas: number[] = []
  const deadline = Date.now() + 12

  while (deltas.length < 25 && Date.now() < deadline) {
    const start = now()
    let end = now()
    // Spin until the value actually changes. Bounded by the deadline above so
    // a clock that never ticks cannot hang the source - which is exactly what
    // a 100ms-clamped clock does inside a 12ms window.
    let guard = 0
    while (end === start && guard++ < 100_000 && Date.now() < deadline) end = now()
    if (end !== start) deltas.push(end - start)
  }

  if (deltas.length === 0) {
    // Every reading was identical inside the window. That means the tick is
    // longer than the window, which is itself the finding - and 100ms clamping
    // is precisely how that happens.
    return 100
  }

  // Rounded, because the raw figure is floating-point noise: Chromium's 100µs
  // clamp measures as 0.09999996423721313, and a value that differs in the
  // twelfth decimal on every visit is a fingerprint of the arithmetic rather
  // than of the browser. Six places is far finer than any clamp in use and
  // coarse enough to be identical across visits.
  return Math.round(Math.min(...deltas) * 1e6) / 1e6
}

export const timingSource: Source<TimingSignal> = {
  id: SOURCE.timing,
  tier: 'fast',
  timeoutMs: 150,
  run() {
    const w = requireWindow()
    const perf = w.performance

    if (typeof perf?.now !== 'function') {
      return compact<TimingSignal>({ has_performance: false })
    }

    // No scheduling-jitter measurement here, deliberately.
    //
    // The obvious one - time five `setTimeout(0)` round trips - measures how
    // busy the main thread is, and the main thread is busy because this SDK's
    // own canvas, font and audio sources are running on it. Measured live it
    // reported ~15ms of "device jitter" that was entirely self-inflicted, and
    // it moved with the scheduler's concurrency setting rather than with the
    // device. A signal that measures the collector is worse than no signal.
    //
    // `now_resolution` has no such problem: it is a busy-spin against the
    // clock's own granularity, so contention cannot change the answer.
    return compact<TimingSignal>({
      has_performance: true,
      now_resolution: clockResolution(() => perf.now()),
    })
  },
}

/**
 * One `PermissionStatus` per name per window, queried once and read live.
 *
 * Chromium keeps every `PermissionStatus` alive for the life of the page, so
 * querying on each identification leaked two objects per call in a long
 * single-page session. Its `state` follows the permission as it changes, so
 * reusing the object loses nothing.
 */
const permissionStatuses = new WeakMap<object, Map<string, Promise<PermissionStatus>>>()

function permissionStatus(w: Window & typeof globalThis, name: PermissionName): Promise<PermissionStatus> {
  let byName = permissionStatuses.get(w.navigator)
  if (!byName) {
    byName = new Map()
    permissionStatuses.set(w.navigator, byName)
  }
  let status = byName.get(name)
  if (!status) {
    status = w.navigator.permissions.query({ name })
    byName.set(name, status)
  }
  return status
}

/**
 * The notification permission, read two ways.
 *
 * `Notification.permission` is the legacy synchronous reading and
 * `permissions.query({name:'notifications'})` is the modern one. They must
 * agree. Headless Chrome auto-denies without recording a decision, so the
 * legacy property says `denied` while the query still says `prompt` - a
 * contradiction an ordinary browser cannot produce.
 */
export const permissionsSource: Source<PermissionsSignal> = {
  id: SOURCE.permissions,
  tier: 'fast',
  timeoutMs: 200,
  async run() {
    const w = requireWindow()
    if (!w.navigator.permissions?.query) throw new UnsupportedSignal('no-permissions-api')

    const query = async (name: PermissionName): Promise<string | undefined> => {
      try {
        return (await permissionStatus(w, name)).state
      } catch {
        // A name this browser does not know. Not an error worth failing over.
        return undefined
      }
    }

    const notification = await query('notifications' as PermissionName)
    const legacy = attempt(() => (w as Window & { Notification?: { permission: string } }).Notification?.permission)

    return compact<PermissionsSignal>({
      notification,
      notification_legacy: legacy,
      geolocation: await query('geolocation' as PermissionName),
      inconsistent:
        notification !== undefined && legacy !== undefined
          ? // `default` and `prompt` are the same state under two names, which
            // is why this is not a plain string comparison.
            (legacy === 'default' ? 'prompt' : legacy) !== notification
          : undefined,
    })
  },
}

/** Globals that only an instrumented or headless build leaves behind. */
const AUTOMATION_GLOBALS = [
  '__nightmare',
  '_phantom',
  'callPhantom',
  '__phantomas',
  'Buffer',
  'emit',
  'spawn',
  '__selenium_evaluate',
  '__selenium_unwrapped',
  '__webdriver_evaluate',
  '__webdriver_script_fn',
  '__webdriver_script_func',
  '__webdriver_unwrapped',
  '__fxdriver_evaluate',
  '__fxdriver_unwrapped',
  '__driver_evaluate',
  '__driver_unwrapped',
  '_Selenium_IDE_Recorder',
  'domAutomation',
  'domAutomationController',
  '__lastWatirAlert',
  '__playwright',
  '__puppeteer',
  '__pw_manual',
] as const

export const automationSource: Source<AutomationSignal> = {
  id: SOURCE.automation,
  tier: 'fast',
  run() {
    const w = requireWindow()

    const present = AUTOMATION_GLOBALS.filter((name) => attempt(() => name in w) === true)

    // ChromeDriver injects properties named `cdc_<random>_...` onto window and
    // onto document. The prefix is the stable part; the middle is per-build.
    const cdp = attempt(() =>
      Object.getOwnPropertyNames(w).filter((name) => /^cdc_|^\$cdc_/.test(name)),
    )

    return compact<AutomationSignal>({
      webdriver: attempt(() => navigator.webdriver),
      cdp_artifacts: cdp && cdp.length > 0 ? cdp : undefined,
      distinctive_properties: present.length > 0 ? [...present] : undefined,
      chrome_object: attempt(() => 'chrome' in w),
      window_external: attempt(() => {
        const external = (w as Window & { external?: unknown }).external
        return external ? String(external) : undefined
      }),
    })
  },
}
