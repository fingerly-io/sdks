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
   * Safari's tell: `navigator.storage.getDirectory()` rejects with a message
   * containing "unknown transient reason" in a private window.
   */
  safari_private?: boolean
  /** Firefox private windows do not expose a service worker registration. */
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
