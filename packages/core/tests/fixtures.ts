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

/**
 * An unremarkable Chrome on a MacBook. Nothing should fire on this.
 *
 * The storage figures are Chrome 152's, measured: `usage + 10 GiB` exactly,
 * from the modern API and the deprecated one alike. That is the constant
 * `kIncognitoStaticStorageQuota` also hands an incognito window, which is why
 * this fixture and an incognito Chrome 152 are the same report and have to
 * reach the same verdict.
 */
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
    quota: 10_737_418_240,
    usage: 0,
    legacy_quota: 10_737_418_240,
    quota_ratio: 0.625,
    service_worker: true,
  }),
  // Measured: Chrome 152 ordinary window, M1 Pro. 3ms relaxed against 11ms strict.
  [SOURCE.storageDurability]: ok({ ratio: 3.778, rounds: 9, honored: true }),
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

/**
 * The same Mac in an incognito window, on a build old enough to say so.
 *
 * Chrome 152 no longer produces this report - it pins the incognito quota to
 * the ordinary constant - but builds that predate the flag do, and they are
 * most of the installed base for a while yet. The ~120MB figure is the oldest
 * of the three shapes the cap has taken.
 */
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
 * Brave on a MacBook, ordinary window. Every number below was measured.
 *
 * The report that broke the private-window detector, kept in the exact shape
 * the browser produced it. Brave 152 / Chromium 152, M1 Pro, 16GB, one machine,
 * two windows a minute apart - this one and [[privateBraveMac]] - so the pair
 * shows what actually moves between them and what only appears to.
 *
 * Three things to notice, because each one broke a different assumption:
 *
 *   - `quota` is 2147483648 here *and* in the private window. Brave pins it.
 *   - `legacy_quota` is 10 GiB here and 3 GiB there. Brave does not pin that.
 *   - `device_memory` is 16 here and 4 there. It is farbled per session, and
 *     both values are ones a real desktop Chromium could report, so neither
 *     can be caught by looking at it.
 *
 * The old detector divided the first by the third, got 0.125, compared it
 * against a 0.3 ceiling and called this an incognito window.
 */
export const braveMac = report({
  ...ordinaryChromeMac.sources,
  [SOURCE.navigator]: ok({
    // Byte-identical to Chrome's. Brave's name appears only in UA-CH.
    user_agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    product_sub: '20030107',
    hardware_concurrency: 10,
    device_memory: 16,
    max_touch_points: 0,
    webdriver: false,
    // Five from Blink plus two Brave invented.
    plugin_count: 7,
    mime_type_count: 2,
    language: 'en-US',
    languages: ['en-US'],
  }),
  [SOURCE.storage]: ok({
    local_storage: true,
    session_storage: true,
    indexed_db: true,
    quota: 2_147_483_648,
    usage: 0,
    legacy_quota: 10_737_418_240,
    quota_ratio: 0.125,
    origin_filesystem: 'ok',
    service_worker: true,
  }),
  [SOURCE.shields]: ok({ brave: true, brave_claimed: true }),
  // Brave removes the Network Information API rather than farbling it.
  [SOURCE.network]: failed('unsupported', 'no-network-information'),
})

/**
 * The same Brave, in a private window, a minute later.
 *
 * The only field that moves for the right reason is `legacy_quota`: 3 GiB
 * against the ordinary window's 10, which is Chromium's incognito pool at
 * 0.1875 of 16GB of physical memory. `device_memory` and
 * `hardware_concurrency` also move, but they move because Brave reseeds them
 * per session, and would have moved the same way between two ordinary windows.
 *
 * The values here are one draw of several observed. A second private window
 * on the same machine minutes later reported `device_memory: 16` - the same as
 * the ordinary window - and `hardware_concurrency: 4`. That is the point: the
 * field is not biased in a direction a rule could correct for, it is redrawn,
 * and a detector reading it is reading a die roll.
 */
export const privateBraveMac = report({
  ...braveMac.sources,
  // Measured: Brave 152 private window, same machine. 2ms against 2ms.
  [SOURCE.storageDurability]: ok({ ratio: 0.962, rounds: 9, honored: true }),
  [SOURCE.navigator]: ok({
    user_agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    product_sub: '20030107',
    hardware_concurrency: 8,
    device_memory: 4,
    max_touch_points: 0,
    webdriver: false,
    plugin_count: 7,
    mime_type_count: 2,
    language: 'en-US',
    languages: ['en-US'],
  }),
  [SOURCE.storage]: ok({
    local_storage: true,
    session_storage: true,
    indexed_db: true,
    quota: 2_147_483_648,
    usage: 0,
    legacy_quota: 3_221_225_472,
    quota_ratio: 0.5,
    origin_filesystem: 'ok',
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
/**
 * Safari 26.5 on macOS, ordinary window. Every value measured.
 *
 * Here because it was reported automated. `errorOwnProperties` returns
 * `column,line,message,sourceURL,stack` on JavaScriptCore - note the `stack`,
 * which V8 also has - and the error-shape vote read that as chromium, against
 * the engine probe's honest `webkit`. Two contradictions fired from that one
 * mis-read, `detect/automation` scored them at 0.5 apiece, and the sum landed
 * exactly on the threshold.
 *
 * The `errors` source is the point of the fixture, so it carries the real
 * property list rather than a plausible one.
 */
export const ordinarySafari = report({
  [SOURCE.engine]: ok({
    to_fixed_error_length: 44,
    eval_length: 37,
    stack_style: 'javascriptcore',
    observed: 'webkit',
    claimed: 'webkit',
    agrees: true,
  }),
  [SOURCE.errors]: ok({
    own_properties: 'column,line,message,sourceURL,stack',
    observed: 'webkit',
  }),
  [SOURCE.navigator]: ok({
    user_agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15',
    platform: 'MacIntel',
    vendor: 'Apple Computer, Inc.',
    product_sub: '20030107',
    hardware_concurrency: 8,
    max_touch_points: 0,
    webdriver: false,
    plugin_count: 5,
    mime_type_count: 2,
    language: 'en-US',
    languages: ['en-US'],
  }),
  [SOURCE.storage]: ok({
    local_storage: true,
    session_storage: true,
    indexed_db: true,
    quota: 82_463_372_084,
    usage: 0,
    origin_filesystem: 'ok',
    service_worker: true,
  }),
  [SOURCE.screen]: ok({
    width: 2056,
    height: 1329,
    device_pixel_ratio: 2,
    inner_width: 2056,
    inner_height: 1153,
    color_depth: 24,
  }),
  [SOURCE.intl]: ok({ timezone: 'Europe/Istanbul', timezone_offset: -180, locale: 'en-US' }),
  [SOURCE.timing]: ok({ now_resolution: 1, has_performance: true, jitter: 0.4 }),
  [SOURCE.canvas]: ok({ geometry: 'c0ffee', text: 'decaf0', unstable: false }),
  [SOURCE.permissions]: ok({
    notification: 'prompt',
    notification_legacy: 'default',
    inconsistent: false,
  }),
})

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

/**
 * Tor Browser 15 on macOS, measured at Standard security on 2026-09-14.
 *
 * Modern Tor no longer matches several historical RFP constants: this run
 * exposed the host timezone and core count and quantised the clock to one
 * 60 Hz frame rather than 100ms. The conservative canvas safety guard records
 * that coarse clock as a blocked readback; together with letterboxing, those
 * are the two independent browser-side signals that identify it.
 */
export const currentTorBrowserMac = report({
  [SOURCE.engine]: ok({
    to_fixed_error_length: 25,
    eval_length: 37,
    stack_style: 'spidermonkey',
    observed: 'gecko',
    claimed: 'gecko',
    agrees: true,
  }),
  [SOURCE.navigator]: ok({
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
    hardware_concurrency: 8,
    language: 'en-US',
    languages: ['en-US', 'en'],
    plugin_count: 5,
  }),
  [SOURCE.timing]: ok({ now_resolution: 16.667, has_performance: true }),
  [SOURCE.intl]: ok({ timezone: 'Europe/Istanbul', timezone_offset: -180, locale: 'en' }),
  [SOURCE.screen]: ok({
    width: 2000,
    height: 1200,
    inner_width: 2000,
    inner_height: 1200,
    device_pixel_ratio: 1,
  }),
  [SOURCE.canvas]: failed('blocked', 'rfp-canvas-prompt-avoided'),
  [SOURCE.fonts]: ok({
    available: Array.from({ length: 9 }, (_, i) => `tor-font-${i}`),
    probed: 90,
  }),
  [SOURCE.storage]: ok({
    local_storage: true,
    session_storage: true,
    indexed_db: true,
    quota: 10_737_418_240,
    usage: 0,
    origin_filesystem: 'refused',
    service_worker: false,
  }),
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
