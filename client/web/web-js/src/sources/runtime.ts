/**
 * Runtime behaviour: Gecko-only `<= 3ms` RFP timer probe, permissions state,
 * and direct automation artefacts.
 */

import {
  SOURCE,
  UnsupportedSignal,
  type AutomationSignal,
  type PermissionsSignal,
  type Source,
  type SourceContext,
  type TimingSignal,
} from '@fingerly/core'

import { attempt, compact, requireWindow } from '../util.js'
import { isGeckoEngine } from './engine.js'

const RFP_SHARED_KEY = 'rfpCanvasBlocked'

/** Bounded wall-clock ceiling (`<= 3.0ms`) for the single-tick Gecko probe. */
const GECKO_PROBE_MAX_MS = 2.8
const GECKO_SPIN_GUARD = 250_000

/** Clamped resolution reported when `performance.now()` did not advance within `~3ms`. */
const CLAMPED_STALL_RESOLUTION_MS = 16.67

function roundResolution(ms: number): number {
  return Math.round(ms * 1e6) / 1e6
}

/**
 * Bounded `2.5ms–3.0ms` single-tick `performance.now()` clamping probe run ONLY
 * on Gecko (`engine === 'gecko'`).
 *
 * - Standard Firefox (`1ms` timer): `0 < delta <= 1.2` -> `rfpBlocked = false`.
 * - Firefox `resistFingerprinting` / Tor Browser (`16.67ms` or `100ms` clamp, or
 *   `0ms` stalled within `3.0ms`): `delta === 0` or `delta >= 1.5` (or outside
 *   `(0, 1.2]`) -> `rfpBlocked = true`.
 */
export function probeGeckoRfp(now: () => number): {
  resolution: number
  rfpBlocked: boolean
} {
  const wallDeadline = Date.now() + GECKO_PROBE_MAX_MS
  const start = now()
  let end = now()
  let guard = 0

  while (end === start && guard++ < GECKO_SPIN_GUARD && Date.now() < wallDeadline) {
    end = now()
  }

  const delta = end - start
  if (delta === 0) {
    return { resolution: CLAMPED_STALL_RESOLUTION_MS, rfpBlocked: true }
  }
  if (delta >= 1.5 || !(delta > 0 && delta <= 1.2)) {
    return {
      resolution: delta > 0 ? roundResolution(delta) : CLAMPED_STALL_RESOLUTION_MS,
      rfpBlocked: true,
    }
  }
  return { resolution: roundResolution(delta), rfpBlocked: false }
}

/**
 * Zero-wait (`0.0ms`) clock sample on non-Gecko engines (Blink/Chromium and
 * WebKit/Safari never show a canvas permission doorhanger).
 */
function sampleNonGeckoClock(now: () => number): number {
  const first = now()
  const second = now()
  return second > first ? roundResolution(second - first) : 0
}

/**
 * Shared gate consulted by BOTH `shieldsSource` and `canvasSource` before
 * touching `<canvas>` or invoking any pixel-readback API.
 */
export function isRfpCanvasBlocked(ctx?: SourceContext): boolean {
  const cached = ctx?.shared?.get(RFP_SHARED_KEY)
  if (typeof cached === 'boolean') return cached

  const timing = ctx?.completed?.(SOURCE.timing)
  if (timing?.status === 'ok') {
    const val = timing.value as TimingSignal | undefined
    if (val?.rfp_canvas_blocked === true) return true
    if (typeof val?.now_resolution === 'number' && val.now_resolution >= 1.5) return true
    if (typeof val?.rfp_canvas_blocked === 'boolean') return val.rfp_canvas_blocked
    if (typeof val?.now_resolution === 'number') return false
  }

  if (isGeckoEngine(ctx)) {
    const w = typeof window === 'undefined' ? undefined : window
    if (typeof w?.performance?.now !== 'function') return true
    const probed = probeGeckoRfp(() => w.performance.now())
    ctx?.shared?.set(RFP_SHARED_KEY, probed.rfpBlocked)
    return probed.rfpBlocked
  }

  return false
}

export const timingSource: Source<TimingSignal> = {
  id: SOURCE.timing,
  stage: 'prerequisite',
  timeoutMs: 50,
  run(ctx) {
    const w = requireWindow()
    const perf = w.performance

    if (typeof perf?.now !== 'function') {
      const gecko = isGeckoEngine(ctx)
      ctx?.shared?.set(RFP_SHARED_KEY, gecko)
      return compact<TimingSignal>({
        has_performance: false,
        rfp_canvas_blocked: gecko,
      })
    }

    if (!isGeckoEngine(ctx)) {
      ctx?.shared?.set(RFP_SHARED_KEY, false)
      return compact<TimingSignal>({
        has_performance: true,
        now_resolution: sampleNonGeckoClock(() => perf.now()),
        rfp_canvas_blocked: false,
      })
    }

    const probed = probeGeckoRfp(() => perf.now())
    ctx?.shared?.set(RFP_SHARED_KEY, probed.rfpBlocked)
    return compact<TimingSignal>({
      has_performance: true,
      now_resolution: probed.resolution,
      rfp_canvas_blocked: probed.rfpBlocked,
    })
  },
}

const permissionStatuses = new WeakMap<object, Map<string, Promise<PermissionStatus>>>()

function permissionStatus(
  w: Window & typeof globalThis,
  name: PermissionName,
): Promise<PermissionStatus> {
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

export const permissionsSource: Source<PermissionsSignal> = {
  id: SOURCE.permissions,
  stage: 'collect',
  timeoutMs: 150,
  async run() {
    const w = requireWindow()
    if (!w.navigator.permissions?.query) throw new UnsupportedSignal('no-permissions-api')

    const query = async (name: PermissionName): Promise<string | undefined> => {
      try {
        return (await permissionStatus(w, name)).state
      } catch {
        return undefined
      }
    }

    const notification = await query('notifications' as PermissionName)
    const legacy = attempt(
      () => (w as Window & { Notification?: { permission: string } }).Notification?.permission,
    )

    return compact<PermissionsSignal>({
      notification,
      notification_legacy: legacy,
      geolocation: await query('geolocation' as PermissionName),
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
  '__playwright__binding__',
  '__pwInitScripts',
  '__puppeteer',
  '__pw_manual',
] as const

const CDC_PATTERN = /^cdc_|^\$cdc_/

function collectCdcMarkers(w: Window & typeof globalThis): string[] {
  const found = new Set<string>()
  const windowProps = attempt(() => Object.getOwnPropertyNames(w))
  if (windowProps) {
    for (const name of windowProps) {
      if (CDC_PATTERN.test(name)) found.add(name)
    }
  }
  const doc = attempt(() => w.document)
  if (doc) {
    const docProps = attempt(() => Object.getOwnPropertyNames(doc))
    if (docProps) {
      for (const name of docProps) {
        if (CDC_PATTERN.test(name)) found.add(name)
      }
    }
  }
  return [...found]
}

export const automationSource: Source<AutomationSignal> = {
  id: SOURCE.automation,
  stage: 'collect',
  embeddedSafe: true,
  identityCritical: true,
  run() {
    const w = requireWindow()

    const present = AUTOMATION_GLOBALS.filter(
      (name) => attempt(() => name in w || (w.document != null && name in w.document)) === true,
    )
    const cdp = collectCdcMarkers(w)

    return compact<AutomationSignal>({
      webdriver: attempt(() => navigator.webdriver),
      cdp_artifacts: cdp.length > 0 ? cdp : undefined,
      distinctive_properties: present.length > 0 ? [...present] : undefined,
      window_external: attempt(() => {
        const external = (w as Window & { external?: unknown }).external
        return external ? String(external) : undefined
      }),
    })
  },
}
