/**
 * The names of the sources, and the shape of what each one reports.
 *
 * This file is the seam between the kernel and the collectors. `@badele/web-js`
 * implements these; `detect/` reads them; the server will eventually parse
 * them. Putting the vocabulary here rather than in the collectors is what lets
 * a detector be written and tested without a browser anywhere in sight, and
 * what will let a native SDK report `screen` in the same shape the web one does.
 *
 * A source id, once shipped, is permanent. Renaming one silently changes every
 * stored report's meaning, so a source that changes shape gets a new id and the
 * old one is retired.
 */

import type { SignalOutcome, SignalReport, SignalStatus } from './types.js'

export const SOURCE = {
  // Claimed identity - everything a browser will simply tell you, and which
  // therefore proves nothing on its own. Valuable only against the observed
  // values further down.
  navigator: 'navigator',
  userAgentData: 'user_agent_data',
  languages: 'languages',
  plugins: 'plugins',
  vendor: 'vendor',

  // Engine ground truth. Derived from behaviour rather than from a string.
  engine: 'engine',
  math: 'math',
  errors: 'errors',

  // Display.
  screen: 'screen',
  screenFrame: 'screen_frame',
  colorGamut: 'color_gamut',
  mediaQueries: 'media_queries',

  // Rendering stack.
  canvas: 'canvas',
  webgl: 'webgl',
  webglExtensions: 'webgl_extensions',

  // Audio stack.
  audio: 'audio',
  audioLatency: 'audio_latency',

  // Text rendering.
  fonts: 'fonts',
  fontPreferences: 'font_preferences',

  // Locale and time.
  intl: 'intl',
  timezone: 'timezone',

  // Storage, and the private-mode probes that live on top of it.
  storage: 'storage',
  storageQuota: 'storage_quota',

  // Device capability.
  hardware: 'hardware',
  touch: 'touch',
  sensors: 'sensors',
  battery: 'battery',
  mediaDevices: 'media_devices',
  network: 'network',
  speech: 'speech',

  // Behaviour of the runtime itself.
  timing: 'timing',
  permissions: 'permissions',
  automation: 'automation',

  // Side effects of the visitor's extensions.
  domBlockers: 'dom_blockers',
} as const

export type SourceId = (typeof SOURCE)[keyof typeof SOURCE]

// ---------------------------------------------------------------------------
// Value shapes.
//
// Every field is optional. A collector that could not read one field should
// still report the ones it could, because a partially-populated source is far
// more useful than a source that threw - and on a browser that removed one
// property of an API, partial is the normal case rather than the exception.
// ---------------------------------------------------------------------------

export interface NavigatorSignal {
  user_agent?: string
  platform?: string
  vendor?: string
  /** Must be `20030107` on Chrome, Safari and Opera. A cheap invariant. */
  product_sub?: string
  app_version?: string
  hardware_concurrency?: number
  device_memory?: number
  max_touch_points?: number
  /** The flag automation is supposed to set. Present here as a claim, not proof. */
  webdriver?: boolean
  cookie_enabled?: boolean
  pdf_viewer_enabled?: boolean
  do_not_track?: string | null
  /** `navigator.plugins.length`. Zero on desktop Chrome is unusual. */
  plugin_count?: number
  mime_type_count?: number
  language?: string
  languages?: string[]
}

/**
 * Engine identity, observed rather than claimed.
 *
 * The technique is `detectincognitojs`'s: `(-1).toFixed(-1)` throws a
 * `RangeError` whose message differs per engine, so its *length* identifies
 * the engine without reading a single string a spoofer edits. Extended here
 * across several builtins, because one probe is one patch away from useless
 * and a spoofer that patches `Number.prototype.toFixed` to fake the length is
 * a spoofer the tamper layer catches doing it.
 */
export interface EngineSignal {
  /** Message length from `(-1).toFixed(-1)`. Chromium 51, WebKit 43/44, Gecko 25. */
  to_fixed_error_length?: number
  /** `eval.toString().length`. Chromium 33, WebKit/Gecko 37, IE 39. */
  eval_length?: number
  /** Shape of `Error.prototype.stack` - V8 alone starts it with the message. */
  stack_style?: 'v8' | 'spidermonkey' | 'javascriptcore' | 'unknown'
  /** What the probes above add up to, before the user-agent is consulted. */
  observed?: string
  /** What the user-agent says. Compared against `observed`, never trusted. */
  claimed?: string
  /**
   * Whether the two agree.
   *
   * Computed by the collector rather than left to each detector, so that
   * "these disagree" means one thing across the codebase. Undefined when
   * either side could not be determined - which is not the same as agreeing.
   */
  agrees?: boolean
}

/**
 * Transcendental maths, which is a fingerprint and a tamper check at once.
 *
 * `Math.sin` and its neighbours are not specified to the last bit. Each engine
 * links its own libm, and the results differ between engines, between builds,
 * and on some functions between CPU vendors - which is why the *ensemble* is a
 * fingerprint component rather than any single value being one.
 *
 * A handful of results are kept individually, and only those measured to
 * separate the three engines on real builds. The rest are hashed: eighteen
 * doubles is four hundred bytes of report, and nobody downstream reads
 * `atanh(0.5)` on its own.
 */
export interface MathSignal {
  /** Hash of the whole vector, in a fixed order. The fingerprint component. */
  hash?: string
  /** How many of the probes returned a finite number, so the hash has a denominator. */
  probed?: number
  /**
   * The two results measured to differ between engines on the same machine.
   *
   * Chrome 151 and Firefox 154 on one M1 Pro agree on seventeen of the
   * nineteen probes to the last bit, and disagree on these two:
   *
   *   atanh(0.5)  0.5493061443340549 against 0.5493061443340548
   *   expm1(1)    1.7182818284590453 against 1.718281828459045
   *
   * Kept as full doubles because that final digit is the entire signal, and
   * kept individually because a hash cannot say *which* way a machine differs.
   * The rest stay in the hash: the ensemble is the fingerprint, and eighteen
   * doubles is four hundred bytes of report nobody reads field by field.
   */
  atanh_half?: number
  expm1_1?: number
  /**
   * Whether the identities that must hold, hold.
   *
   * `Math.sin(0)` is zero and `Math.cos(0)` is one in every conforming engine,
   * on every platform, by specification rather than by implementation. A
   * visitor whose maths gets these wrong is not on an unusual CPU: something
   * has replaced `Math`, which is what the extensions that add noise to
   * fingerprintable APIs do.
   */
  identities_hold?: boolean
}

/**
 * What the engine's errors look like.
 *
 * The strongest engine ground truth there is, because none of it is a value
 * anyone thought to make configurable: the wording of a `TypeError`, whether
 * `Error.captureStackTrace` exists, which non-standard properties an error
 * carries. A build that rewrites its user agent has all of this to rewrite as
 * well, and rewriting it means patching builtins, which `lies/` then finds.
 *
 * Message *lengths* rather than message text, for the same reason
 * `engine.to_fixed_error_length` uses a length: a reworded message across
 * versions still lands in the right bucket, and the report does not carry
 * three English sentences a browser release can invalidate.
 */
export interface ErrorsSignal {
  /**
   * Message lengths, measured rather than assumed.
   *
   * Chrome 151 against Firefox 154, on one machine:
   *
   *   null.x                44 ("Cannot read properties of null (reading 'x')")
   *                         33 ("can't access property \"x\" of null")
   *   new Function('!')     20 / 28
   *   JSON.parse('{')       69 / 89
   *   [].length = -1        68 / 20
   *   assignment to const   32 / 31
   *
   * Lengths rather than text, for the reason `engine.to_fixed_error_length`
   * uses one: a reworded message across versions still lands in the right
   * bucket, and the report does not carry six English sentences that a browser
   * release can invalidate.
   *
   * Probes that measured *identical* on both engines are not collected -
   * `undefined()`, `[].reduce()` and a missing method on a null-prototype
   * object all produce the same length in both - because a probe that does not
   * discriminate is report weight without signal.
   */
  null_property_length?: number
  syntax_length?: number
  json_parse_length?: number
  invalid_array_length?: number
  const_assign_length?: number
  /**
   * The own property names of a caught `Error`, sorted and joined.
   *
   * The strongest single tell here, and the one nobody thinks to spoof:
   * `message,stack` on V8, `columnNumber,fileName,lineNumber,message` on
   * SpiderMonkey, which puts `stack` on the prototype instead.
   */
  own_properties?: string
  /**
   * `Error.captureStackTrace` and `Error.stackTraceLimit`.
   *
   * Still collected, no longer decisive. Both were V8's alone for years and
   * every fingerprinting library still treats them that way; Firefox 154
   * reports both as present, which is exactly the sort of assumption that
   * quietly turns into a false positive - it made this collector call an
   * ordinary Firefox "chromium" until it was measured.
   */
  capture_stack_trace?: boolean
  stack_trace_limit?: boolean
  /**
   * The engine these add up to, decided here and not by a detector.
   *
   * Its own reading, independent of `engine.observed`: two probes of the same
   * thing that can disagree are worth more than one that cannot, and the
   * disagreement is what a partial spoof looks like.
   */
  observed?: string
}

export interface ScreenSignal {
  width?: number
  height?: number
  avail_width?: number
  avail_height?: number
  color_depth?: number
  pixel_depth?: number
  device_pixel_ratio?: number
  orientation?: string
  /** Window chrome insets: top, right, bottom, left. Null while fullscreen. */
  frame?: (number | null)[]
  inner_width?: number
  inner_height?: number
}

export interface WebGLSignal {
  vendor?: string
  renderer?: string
  /** From `WEBGL_debug_renderer_info`, where the browser still exposes it. */
  unmasked_vendor?: string
  unmasked_renderer?: string
  version?: string
  shading_language_version?: string
  max_texture_size?: number
  max_render_buffer_size?: number
  /** Hashed rather than sent whole - see [[hash64]]. */
  parameters_hash?: string
  shader_precision_hash?: string
}

export interface CanvasSignal {
  /** Hash of the geometry rendering. */
  geometry?: string
  /** Hash of the text rendering, which is where font and hinting differences land. */
  text?: string
  winding?: boolean
  /**
   * True when two consecutive renders of the same input disagreed.
   *
   * That is the signature of per-read canvas noise - Brave's farbling, Tor's
   * RFP, several anti-detect browsers - and it is worth strictly more than the
   * hash it invalidates.
   */
  unstable?: boolean
}

export interface AudioSignal {
  /** Sum of the rendered buffer. The classic audio fingerprint. */
  value?: number
  sample_rate?: number
  /** Same idea as `CanvasSignal.unstable`: two renders that disagree. */
  unstable?: boolean
  state?: string
  base_latency?: number
}

export interface FontsSignal {
  /** Which of the probed fonts rendered at a distinguishable width. */
  available?: string[]
  /** How many were probed, so `available.length` is a ratio and not a count. */
  probed?: number
}

export interface IntlSignal {
  timezone?: string
  timezone_offset?: number
  locale?: string
  calendar?: string
  numbering_system?: string
  /** `Intl.DateTimeFormat().format()` of a fixed instant. Catches locale data differences. */
  formatted?: string
}

/**
 * Storage availability and the private-mode probes.
 *
 * Every field is its own probe with its own answer. A single `incognito`
 * boolean - which is what `detectincognitojs` returns - throws away which
 * engine's tell fired, and the engine is what makes the verdict defensible.
 */
export interface StorageSignal {
  local_storage?: boolean
  session_storage?: boolean
  indexed_db?: boolean
  /** `navigator.storage.estimate().quota`, in bytes. */
  quota?: number
  /** `deviceMemory`-derived expectation, so the quota can be read as a ratio. */
  quota_ratio?: number
  /**
   * What `navigator.storage.getDirectory()` did. One probe, and the two
   * engines that refuse it refuse it differently:
   *
   * - `ok` - the origin private file system opened. An ordinary window.
   * - `transient` - rejected naming an "unknown transient reason". Safari's
   *   private windows, and nothing else.
   * - `refused` - rejected with a `SecurityError`. Firefox private browsing,
   *   where OPFS is switched off (Mozilla bug 1785125; supporting it is still
   *   open as bug 1975760).
   * - `failed` - rejected some other way, which is evidence of nothing.
   *
   * Reported as the raw outcome rather than as a boolean per browser because
   * the engine gate belongs in the detector: `refused` in a Chromium iframe
   * with storage blocked is not a private window, and only the engine says so.
   */
  origin_filesystem?: 'ok' | 'transient' | 'refused' | 'failed'
  /**
   * Legacy Safari tell, kept so a report stored by an older SDK still reads.
   * Superseded by `origin_filesystem: 'transient'`, which is the same probe.
   */
  safari_private?: boolean
  /**
   * Whether a service worker container is exposed.
   *
   * This was Firefox's private-window tell until Firefox 138, which shipped
   * service workers in private browsing (Mozilla bug 1320796) and closed it.
   * Kept because it still fires on older builds and on permanent private
   * browsing, and because "no container at all" is worth reporting anyway.
   */
  service_worker?: boolean
}

export interface HardwareSignal {
  hardware_concurrency?: number
  device_memory?: number
  /** From UA-CH, where available. Claimed, not measured. */
  architecture?: string
  bitness?: string
  platform_version?: string
}

export interface TouchSignal {
  max_touch_points?: number
  /** Whether `ontouchstart` is on `window` at all. */
  touch_event?: boolean
  touch_start?: boolean
  /** `matchMedia('(pointer: coarse)')`. Should agree with the two above. */
  pointer_coarse?: boolean
  /** `matchMedia('(any-hover: hover)')`. A phone that hovers is a lie. */
  any_hover?: boolean
}

export interface SensorsSignal {
  device_motion?: boolean
  device_orientation?: boolean
  /** Whether a motion event actually fired inside the probe window. */
  motion_observed?: boolean
}

/**
 * How precise the clock is, and how the main thread behaves.
 *
 * `performance.now()` resolution is the single cleanest Tor tell there is:
 * `privacy.resistFingerprinting` clamps it to 100ms, a value no ordinary
 * browser reports. Chrome clamps to 100µs cross-origin-isolated, 5µs otherwise.
 */
export interface TimingSignal {
  /** Smallest non-zero delta observed between consecutive `now()` calls, in ms. */
  now_resolution?: number
  /** Whether `performance.now()` exists at all. */
  has_performance?: boolean
  /**
   * Median main-thread scheduling jitter, in ms.
   *
   * Reserved, and not currently collected by the web SDK. The obvious
   * measurement - timing `setTimeout(0)` round trips - reports the collector's
   * own contention rather than the device's, so it is left unpopulated until
   * there is somewhere to measure it that is not competing with the sources.
   */
  jitter?: number
}

export interface PermissionsSignal {
  notification?: string
  /** `Notification.permission`. Must agree with `notification` above. */
  notification_legacy?: string
  geolocation?: string
  /** Where the two notification readings disagree - a headless Chrome tell. */
  inconsistent?: boolean
}

/**
 * The direct automation tells.
 *
 * Cheap and easily removed, which is why they are only one input to the
 * verdict. What is not easily removed is the *tampering* the removal requires,
 * and that lands in [[IntegrityReport]] instead.
 */
export interface AutomationSignal {
  webdriver?: boolean
  /** `window.cdc_...` and friends, left behind by ChromeDriver. */
  cdp_artifacts?: string[]
  /** Properties only a headless or instrumented build exposes. */
  distinctive_properties?: string[]
  /** `window.chrome` present on a browser claiming to be Chrome. */
  chrome_object?: boolean
  /** `window.external.toString()`, where it exists. */
  window_external?: string
}

export interface NetworkSignal {
  effective_type?: string
  downlink?: number
  rtt?: number
  save_data?: boolean
}

export interface MediaDevicesSignal {
  audio_input?: number
  audio_output?: number
  video_input?: number
  /** True when the browser reports devices but no labels, i.e. no permission. */
  labels_hidden?: boolean
}

/** The `matchMedia` family. Cheap, synchronous, and rich in accessibility state. */
export interface MediaQueriesSignal {
  color_gamut?: string
  inverted_colors?: boolean
  forced_colors?: boolean
  monochrome?: number
  contrast?: string
  reduced_motion?: boolean
  reduced_transparency?: boolean
  hdr?: boolean
}

// ---------------------------------------------------------------------------
// Reading a report.
// ---------------------------------------------------------------------------

/**
 * The value of a source that succeeded, or `undefined`.
 *
 * Detectors use this rather than reaching into `report.sources` so that the
 * "did it succeed" check cannot be forgotten - reading `.value` off a source
 * that timed out yields `undefined` either way, and a detector that treated
 * that as "the feature is absent" would produce confident nonsense on a slow
 * connection.
 */
export function valueOf<T>(report: SignalReport, id: string): T | undefined {
  const outcome = report.sources[id]
  return outcome?.status === 'ok' ? (outcome.value as T) : undefined
}

export function statusOf(report: SignalReport, id: string): SignalStatus | undefined {
  return report.sources[id]?.status
}

export function outcomeOf(report: SignalReport, id: string): SignalOutcome | undefined {
  return report.sources[id]
}

/** Whether a source was actively refused, as opposed to absent or slow. */
export function wasBlocked(report: SignalReport, id: string): boolean {
  return statusOf(report, id) === 'blocked'
}
