/**
 * Reports standing in for real devices.
 *
 * These exist because `detect/` is a pure function of a report. A detector for
 * "Tor Browser on Windows" cannot have a regression test if testing it needs
 * Tor Browser on Windows; it can if the report is data. Every fixture below is
 * the shape a real device produces, trimmed to the sources the detectors read.
 */

import { SOURCE } from '../src/signals.js'
import type { SignalOutcome, SignalReport, SignalStatus } from '../src/types.js'

const ok = (value: unknown): SignalOutcome => ({ status: 'ok', ms: 1, value })
const failed = (status: SignalStatus, reason?: string): SignalOutcome =>
  reason === undefined ? { status, ms: 1 } : { status, ms: 1, reason }

export function report(
  sources: Record<string, SignalOutcome>,
  integrity: Partial<SignalReport['integrity']> = {},
): SignalReport {
  return {
    schema: 1,
    budget_ms: 1200,
    elapsed_ms: 40,
    tiers: ['fast', 'deferred'],
    sources,
    integrity: {
      patched_natives: [],
      lies: [],
      engine: {},
      ...integrity,
    },
  }
}

/** An unremarkable Chrome on a MacBook. Nothing should fire on this. */
export const ordinaryChromeMac = report({
  [SOURCE.engine]: ok({
    to_fixed_error_length: 51,
    eval_length: 33,
    stack_style: 'v8',
    observed: 'chromium',
    claimed: 'chromium',
    agrees: true,
  }),
  [SOURCE.navigator]: ok({
    user_agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    product_sub: '20030107',
    hardware_concurrency: 10,
    device_memory: 8,
    max_touch_points: 0,
    webdriver: false,
    plugin_count: 5,
    language: 'en-GB',
    languages: ['en-GB', 'en'],
  }),
  [SOURCE.screen]: ok({
    width: 1728,
    height: 1117,
    device_pixel_ratio: 2,
    inner_width: 1728,
    inner_height: 980,
    color_depth: 30,
  }),
  [SOURCE.storage]: ok({
    local_storage: true,
    session_storage: true,
    indexed_db: true,
    quota: 300_000_000_000,
    quota_ratio: 0.6,
    service_worker: true,
  }),
  [SOURCE.timing]: ok({ now_resolution: 0.1, has_performance: true, jitter: 0.4 }),
  [SOURCE.intl]: ok({ timezone: 'Europe/London', timezone_offset: -60, locale: 'en-GB' }),
  [SOURCE.webgl]: ok({
    vendor: 'Google Inc. (Apple)',
    renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)',
    unmasked_renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)',
  }),
  [SOURCE.canvas]: ok({ geometry: 'a1b2c3d4e5f60718', text: '0718f6e5d4c3b2a1', unstable: false }),
  [SOURCE.touch]: ok({
    max_touch_points: 0,
    touch_event: false,
    pointer_coarse: false,
    any_hover: true,
  }),
  [SOURCE.fonts]: ok({ available: Array.from({ length: 42 }, (_, i) => `font-${i}`), probed: 60 }),
  [SOURCE.mediaDevices]: ok({ audio_input: 1, audio_output: 2, video_input: 1 }),
  [SOURCE.permissions]: ok({
    notification: 'prompt',
    notification_legacy: 'default',
    inconsistent: false,
  }),
})

/** The same Mac, in an incognito window. Only the quota moves. */
export const incognitoChromeMac = report({
  ...ordinaryChromeMac.sources,
  [SOURCE.storage]: ok({
    local_storage: true,
    session_storage: true,
    indexed_db: true,
    quota: 104_857_600,
    quota_ratio: 0.02,
    service_worker: true,
  }),
})

/**
 * Firefox in a private window, on a build that has closed the old tells.
 *
 * Web storage, IndexedDB and the service worker container are all present and
 * identical to an ordinary window - which is the whole difficulty, and what a
 * fixture written from the old assumption hid. The origin private file system
 * is the one thing that still differs.
 */
export const privateFirefox = report({
  [SOURCE.engine]: ok({
    to_fixed_error_length: 25,
    eval_length: 37,
    stack_style: 'spidermonkey',
    observed: 'gecko',
    claimed: 'gecko',
    agrees: true,
  }),
  [SOURCE.navigator]: ok({
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0',
    hardware_concurrency: 10,
    language: 'en-GB',
    languages: ['en-GB', 'en'],
  }),
  [SOURCE.storage]: ok({
    local_storage: true,
    session_storage: true,
    indexed_db: true,
    origin_filesystem: 'refused',
    service_worker: true,
  }),
  [SOURCE.timing]: ok({ now_resolution: 1, has_performance: true }),
  [SOURCE.intl]: ok({ timezone: 'Europe/London', timezone_offset: -60 }),
})

/**
 * The same Firefox, in an ordinary window.
 *
 * Everything the private one reports, with the one field that separates them
 * flipped - which is what makes it worth having: a detector that fires on both
 * is caught here rather than by a visitor.
 */
export const ordinaryFirefox = report({
  ...privateFirefox.sources,
  [SOURCE.storage]: ok({
    local_storage: true,
    session_storage: true,
    indexed_db: true,
    origin_filesystem: 'ok',
    service_worker: true,
  }),
})

/** Firefox before 138, where the missing service worker was still the tell. */
export const privateFirefoxLegacy = report({
  ...privateFirefox.sources,
  [SOURCE.storage]: ok({
    local_storage: true,
    session_storage: true,
    indexed_db: true,
    service_worker: false,
  }),
})

/** Safari in a private window. */
export const privateSafari = report({
  [SOURCE.engine]: ok({
    to_fixed_error_length: 44,
    eval_length: 37,
    stack_style: 'javascriptcore',
    observed: 'webkit',
    claimed: 'webkit',
    agrees: true,
  }),
  [SOURCE.storage]: ok({
    local_storage: true,
    session_storage: true,
    indexed_db: true,
    origin_filesystem: 'transient',
  }),
  [SOURCE.timing]: ok({ now_resolution: 1, has_performance: true }),
})

/** Tor Browser, with resistFingerprinting doing its work. */
export const torBrowser = report({
  [SOURCE.engine]: ok({
    to_fixed_error_length: 25,
    eval_length: 37,
    stack_style: 'spidermonkey',
    observed: 'gecko',
    claimed: 'gecko',
    agrees: true,
  }),
  [SOURCE.navigator]: ok({
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0',
    hardware_concurrency: 2,
    language: 'en-US',
    languages: ['en-US'],
    plugin_count: 0,
  }),
  [SOURCE.timing]: ok({ now_resolution: 100, has_performance: true }),
  [SOURCE.intl]: ok({ timezone: 'UTC', timezone_offset: 0, locale: 'en-US' }),
  [SOURCE.screen]: ok({
    width: 1920,
    height: 1080,
    inner_width: 1600,
    inner_height: 900,
    device_pixel_ratio: 1,
  }),
  [SOURCE.canvas]: failed('blocked', 'SecurityError'),
  [SOURCE.audio]: failed('blocked', 'audio-noised'),
  [SOURCE.fonts]: failed('blocked', 'font-enumeration-restricted'),
  [SOURCE.storage]: ok({ local_storage: true, session_storage: true, indexed_db: true }),
})

/** Headless Chrome under Puppeteer, with a stealth plugin doing a poor job. */
export const stealthHeadlessChrome = report(
  {
    [SOURCE.engine]: ok({
      to_fixed_error_length: 51,
      eval_length: 33,
      stack_style: 'v8',
      observed: 'chromium',
      claimed: 'webkit',
      agrees: false,
    }),
    [SOURCE.navigator]: ok({
      user_agent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      product_sub: '20100101',
      hardware_concurrency: 4,
      max_touch_points: 0,
      webdriver: false,
      plugin_count: 0,
    }),
    [SOURCE.screen]: ok({
      width: 1280,
      height: 720,
      inner_width: 1280,
      inner_height: 720,
      device_pixel_ratio: 1,
    }),
    [SOURCE.automation]: ok({
      webdriver: false,
      cdp_artifacts: ['cdc_adoQpoasnfa76pfcZLmcfl_Array'],
      distinctive_properties: [],
    }),
    [SOURCE.permissions]: ok({
      notification: 'prompt',
      notification_legacy: 'denied',
      inconsistent: true,
    }),
    [SOURCE.timing]: ok({ now_resolution: 0.1, has_performance: true }),
    [SOURCE.storage]: ok({ local_storage: true, session_storage: true, indexed_db: true }),
  },
  {
    patched_natives: [
      'navigator.webdriver.get',
      'navigator.plugins.get',
      'Function.prototype.toString',
    ],
    lies: [
      { id: 'navigator.webdriver', kind: 'descriptor' },
      { id: 'user-agent-vs-engine', kind: 'contradiction' },
    ],
    engine: { claimed: 'webkit', observed: 'chromium', agrees: false },
  },
)

/** An Android emulator rendering through SwiftShader. */
export const androidEmulator = report({
  [SOURCE.engine]: ok({
    to_fixed_error_length: 51,
    eval_length: 33,
    observed: 'chromium',
    claimed: 'chromium',
    agrees: true,
  }),
  [SOURCE.navigator]: ok({
    user_agent:
      'Mozilla/5.0 (Linux; Android 14; sdk_gphone64_arm64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    hardware_concurrency: 4,
    device_memory: 2,
    max_touch_points: 0,
    plugin_count: 0,
    language: 'en-US',
    languages: ['en-US'],
  }),
  [SOURCE.webgl]: ok({
    vendor: 'Google Inc. (Google)',
    renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))',
    unmasked_renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))',
  }),
  [SOURCE.screen]: ok({
    width: 1080,
    height: 1920,
    device_pixel_ratio: 1,
    inner_width: 1080,
    inner_height: 1800,
  }),
  [SOURCE.touch]: ok({
    max_touch_points: 0,
    touch_event: false,
    pointer_coarse: false,
    any_hover: true,
  }),
  [SOURCE.sensors]: ok({ device_motion: false, device_orientation: false }),
  [SOURCE.storage]: ok({ local_storage: true, session_storage: true, indexed_db: true }),
  [SOURCE.timing]: ok({ now_resolution: 0.1, has_performance: true }),
  [SOURCE.fonts]: ok({ available: ['font-0', 'font-1'], probed: 60 }),
  [SOURCE.mediaDevices]: ok({ audio_input: 0, audio_output: 0, video_input: 0 }),
})

/** A real Pixel. Shares the mobile user-agent with the emulator and nothing else. */
export const realAndroidPhone = report({
  [SOURCE.engine]: ok({
    to_fixed_error_length: 51,
    eval_length: 33,
    observed: 'chromium',
    claimed: 'chromium',
    agrees: true,
  }),
  [SOURCE.navigator]: ok({
    user_agent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    hardware_concurrency: 9,
    device_memory: 8,
    max_touch_points: 5,
    plugin_count: 0,
    language: 'en-GB',
    languages: ['en-GB', 'en'],
  }),
  [SOURCE.webgl]: ok({
    vendor: 'Qualcomm',
    renderer: 'Adreno (TM) 740',
    unmasked_renderer: 'Adreno (TM) 740',
  }),
  [SOURCE.screen]: ok({
    width: 412,
    height: 915,
    device_pixel_ratio: 2.625,
    inner_width: 412,
    inner_height: 780,
  }),
  [SOURCE.touch]: ok({
    max_touch_points: 5,
    touch_event: true,
    pointer_coarse: true,
    any_hover: false,
  }),
  [SOURCE.sensors]: ok({ device_motion: true, device_orientation: true, motion_observed: true }),
  [SOURCE.storage]: ok({ local_storage: true, session_storage: true, indexed_db: true }),
  [SOURCE.timing]: ok({ now_resolution: 0.1, has_performance: true }),
  [SOURCE.fonts]: ok({ available: Array.from({ length: 20 }, (_, i) => `f${i}`), probed: 60 }),
  [SOURCE.mediaDevices]: ok({ audio_input: 1, audio_output: 1, video_input: 2 }),
})
