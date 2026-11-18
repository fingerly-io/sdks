/**
 * The names of the sources, and the shape of what each one reports.
 *
 * `@fingerly/web-js` implements these and the server reads them.
 */

import type { SignalOutcome, SignalReport, SignalStatus } from './types.js'

export const SOURCE = {
  // Claimed identity.
  navigator: 'navigator',
  userAgentData: 'user_agent_data',
  languages: 'languages',
  vendor: 'vendor',

  // Engine ground truth.
  engine: 'engine',
  math: 'math',
  errors: 'errors',

  // Isolated DedicatedWorkerGlobalScope cross-check.
  workerRealm: 'worker_realm',

  // Display.
  screen: 'screen',
  screenFrame: 'screen_frame',
  colorGamut: 'color_gamut',
  mediaQueries: 'media_queries',

  // Rendering stack.
  canvas: 'canvas',
  webgl: 'webgl',
  webgl2: 'webgl2',
  webglExtensions: 'webgl_extensions',
  webgpu: 'webgpu',

  // Audio stack.
  audio: 'audio',
  audioLatency: 'audio_latency',

  // Text & speech synthesis.
  fonts: 'fonts',
  fontPreferences: 'font_preferences',
  voices: 'voices',

  // Locale and time.
  intl: 'intl',
  timezone: 'timezone',

  // Storage, and the private-mode probes that live on top of it.
  storage: 'storage',
  storageQuota: 'storage_quota',
  storageDurability: 'storage_durability',

  // Device capability.
  hardware: 'hardware',
  touch: 'touch',
  mediaDevices: 'media_devices',
  codecs: 'codecs',
  applePay: 'apple_pay',
  network: 'network',

  // Behaviour of the runtime itself.
  timing: 'timing',
  permissions: 'permissions',
  automation: 'automation',

  // Countermeasures the browser itself applies to everything above.
  shields: 'shields',

  // Embedded in-app WebView marker.
  embedding: 'embedding',
} as const

export type SourceId = (typeof SOURCE)[keyof typeof SOURCE]

/**
 * The embedded WebView profile (`F-01`, `WEB-07`): the only sources that run
 * inside a detected in-app WebView, plus the `embedding` marker and the
 * integrity block. Each one is there because the server's embedded-claim
 * contradiction check reads it:
 *
 * - `engine`, `math`, `errors`: engine behaviour, no device values.
 * - `navigator`: reduced to `user_agent`, `platform` and `webdriver`.
 * - `worker_realm`: reduced to the worker's `user_agent` and `platform`.
 * - `automation`: webdriver and automation globals.
 *
 * Core count, device memory, languages, time zone and GPU strings are not read
 * in this profile by any source.
 */
export const EMBEDDED_SAFE_SOURCES: ReadonlySet<string> = new Set<string>([
  SOURCE.engine,
  SOURCE.automation,
  SOURCE.math,
  SOURCE.errors,
  SOURCE.navigator,
  SOURCE.workerRealm,
  SOURCE.embedding,
])

export interface EmbeddingSignal {
  /**
   * `app-scheme`, `android-webview`, `apple-webview`, `electron`, `capacitor`,
   * `cordova`, `react-native-webview` or `flutter-webview`.
   */
  kind: string
}

export interface NavigatorSignal {
  user_agent?: string
  platform?: string
  vendor?: string
  product_sub?: string
  app_version?: string
  hardware_concurrency?: number
  device_memory?: number
  max_touch_points?: number
  webdriver?: boolean
  cookie_enabled?: boolean
  pdf_viewer_enabled?: boolean
  do_not_track?: string | null
  plugin_count?: number
  mime_type_count?: number
  language?: string
  languages?: string[]
}

export interface LanguagesSignal {
  primary?: string
  accepted?: string[]
}

export interface VendorSignal {
  vendor?: string
}

export interface EngineSignal {
  to_fixed_error_length?: number
  eval_length?: number
  stack_style?: 'v8' | 'spidermonkey' | 'javascriptcore' | 'unknown'
  observed?: string
  claimed?: string
  /** Structural check (`typeof DeviceMotionEvent?.requestPermission === 'function'`), never invoked. */
  has_motion_permission_fn?: boolean
  /** `CSS.supports('-moz-appearance', 'none')`. */
  moz_appearance?: boolean
  /** `CSS.supports('-webkit-touch-callout', 'none')`. */
  webkit_touch_callout?: boolean
}

export interface MathSignal {
  probed?: number
  atanh_half?: number
  expm1_1?: number
  identities_hold?: boolean
}

/**
 * Error message lengths and shapes, measured without evaluating code
 * (`WEB-10`): no `new Function` and no `eval` call, so a strict CSP raises no
 * violation. The raw lengths are the evidence the server derives the engine
 * from; `observed` is the page's own vote, kept next to them.
 */
export interface ErrorsSignal {
  null_property_length?: number
  json_parse_length?: number
  invalid_array_length?: number
  /** `new RegExp('(')`: the SyntaxError message length. */
  regexp_syntax_length?: number
  /** `Object.defineProperty` on a frozen object: the TypeError message length. */
  redefine_length?: number
  own_properties?: string
  capture_stack_trace?: boolean
  stack_trace_limit?: boolean
  observed?: string
}

export interface WorkerRealmSignal {
  user_agent?: string
  platform?: string
  /** Not collected in the embedded WebView profile. */
  hardware_concurrency?: number
  /** Not collected in the embedded WebView profile. */
  device_memory?: number
  /** Not collected in the embedded WebView profile. */
  languages?: string[]
  /** Not collected in the embedded WebView profile. */
  timezone?: string
  /** Not collected in the embedded WebView profile. */
  unmasked_vendor?: string
  /** Not collected in the embedded WebView profile. */
  unmasked_renderer?: string
  /**
   * The worker answered with its navigator values but not, within the budget,
   * with the GPU strings (a cold first WebGL context). Absent otherwise.
   */
  gpu_unanswered?: boolean
}

/**
 * Browser countermeasures. The three booleans are the page's reading; the
 * fields after them are the observations each reading rests on, so the server
 * can derive the same conclusion itself (`WEB-02`).
 */
export interface ShieldsSignal {
  brave?: boolean
  brave_claimed?: boolean
  canvas_noise?: boolean
  /**
   * What `navigator.brave.isBrave()` did: `true` or `false` (its answer),
   * `timeout`, `threw`, `not-function` (present but not callable) or `absent`.
   */
  brave_api?: 'true' | 'false' | 'timeout' | 'threw' | 'not-function' | 'absent'
  /** The brand names in `navigator.userAgentData.brands`, in order. */
  brands?: string[]
  /** Canary pixels read back, out of 64 drawn (8x8). Absent when the readback failed. */
  canary_pixels?: number
  /** How many of those pixels differ from the colour drawn, in any channel. */
  canary_mismatched?: number
  /** The largest absolute difference in any one channel, 0 to 255. */
  canary_max_delta?: number
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
  frame?: (number | null)[]
  inner_width?: number
  inner_height?: number
}

export interface ScreenFrameSignal {
  frame?: (number | null)[]
}

export interface ColorGamutSignal {
  gamut?: 'srgb' | 'p3' | 'rec2020'
}

export interface WebGLSignal {
  vendor?: string
  renderer?: string
  unmasked_vendor?: string
  unmasked_renderer?: string
  version?: string
  shading_language_version?: string
  max_texture_size?: number
  max_render_buffer_size?: number
  parameters_hash?: string
  shader_precision_hash?: string
  /**
   * Offscreen WebGL 1 shaded scene hashed over raw `readPixels` RGBA bytes.
   * Skipped under Gecko `resistFingerprinting` and omitted when shaders fail.
   */
  render_hash?: string
  /** True when `createShader` returned `null` or failed to compile (e.g. Brave strict mode). */
  shader_blocked?: boolean
}

export interface WebGL2Signal {
  limits?: Record<string, number | number[]>
  extensions?: string[]
}

export interface WebGPUSignal {
  features?: string[]
  limits?: Record<string, number>
  vendor?: string
  architecture?: string
}

export interface CanvasSignal {
  geometry?: string
  text?: string
  /** `geometry` pixel buffer hashed with bit 0 cleared (`byte & 0xfe`), undoing 1-bit LSB farbling. */
  geometry_high?: string
  /** Generic-font (`serif`/`sans-serif`/`monospace`) text render hashed with bit 0 cleared (`byte & 0xfe`). */
  text_high?: string
  /** `measureText` advance width on a fixed ASCII probe (`0` when `TextMetrics` is stubbed). */
  text_metrics_width?: number
  winding?: boolean
  unstable?: boolean
}

export interface AudioSignal {
  value?: number
  /** Scale-invariant crest ratio (`sum / maxAbs`) over `[4500..5000)`, cancelling constant gain farbling. */
  crest_ratio?: number
  /** Scale-invariant RMS-to-mean ratio (`sqrt(sumSq) / sum`) over `[4500..5000)`. */
  shape_ratio?: number
  /** Scale-invariant compressor decay ratio (`earlySum / lateSum`) over `[4500..4750)` vs `[4750..5000)`. */
  decay_ratio?: number
  /** Count of negative samples in `[4500..5000)` (`0` when replaced by non-negative PRNG noise). */
  negative_samples?: number
  sample_rate?: number
  unstable?: boolean
  state?: string
  base_latency?: number
  max_channels?: number
}

export interface FontsSignal {
  available?: string[]
  probed?: number
}

export interface FontPreferencesSignal {
  widths?: Record<string, number>
}

export interface VoicesSignal {
  voices?: string[]
  default_voice?: string
}

export interface CodecsSignal {
  rtc_video?: string[]
  hw_av1?: boolean
  hw_hevc10?: boolean
  hw_vp9_p2?: boolean
}

export interface ApplePaySignal {
  can_make_payments?: boolean
  max_version?: number
}

export interface IntlSignal {
  timezone?: string
  timezone_offset?: number
  locale?: string
  calendar?: string
  numbering_system?: string
  hour_cycle?: string
  formatted?: string
}

export interface TimezoneSignal {
  name?: string
  offset?: number
}

export interface StorageSignal {
  local_storage?: boolean
  session_storage?: boolean
  indexed_db?: boolean
  quota?: number
  usage?: number
  legacy_quota?: number
  quota_ratio?: number
  origin_filesystem?: 'ok' | 'transient' | 'refused' | 'failed'
  service_worker?: boolean
}

export interface StorageDurabilitySignal {
  ratio?: number
  rounds?: number
  honored?: boolean
}

export interface HardwareSignal {
  hardware_concurrency?: number
  device_memory?: number
  architecture?: string
  bitness?: string
  platform_version?: string
}

export interface TouchSignal {
  max_touch_points?: number
  touch_event?: boolean
  touch_start?: boolean
  pointer_coarse?: boolean
  any_hover?: boolean
  device_motion?: boolean
  device_orientation?: boolean
}

export interface TimingSignal {
  now_resolution?: number
  has_performance?: boolean
  rfp_canvas_blocked?: boolean
  jitter?: number
}

export interface PermissionsSignal {
  notification?: string
  notification_legacy?: string
  geolocation?: string
}

export interface AutomationSignal {
  webdriver?: boolean
  cdp_artifacts?: string[]
  distinctive_properties?: string[]
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
  labels_hidden?: boolean
}

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

export function wasBlocked(report: SignalReport, id: string): boolean {
  return statusOf(report, id) === 'blocked'
}
