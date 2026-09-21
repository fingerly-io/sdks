/**
 * @fingerly/core - the framework-agnostic kernel every Fingerly SDK is built on.
 *
 * It contains no browser code. The collectors live in `@fingerly/web-js`, and the
 * mobile SDKs bring their own; `@fingerly/node` depends on this package and must
 * not carry a DOM.
 */

export { FingerlyClient, SCHEMA_VERSION } from './client.js'
export type { FingerlyClientOptions, IdentifyOptions } from './client.js'
export { DEFAULT_ENDPOINT } from './routing.js'
export { ConsentError } from './consent.js'

export { collect } from './scheduler.js'
export type { ScheduleOptions, ScheduleResult } from './scheduler.js'

export {
  BlockedSignal,
  reasonOf,
  TimedOutSignal,
  UnsupportedSignal,
  type Source,
  type SourceContext,
} from './source.js'

export { canonicalize, type Canonical } from './canonical.js'
export { hash64 } from './hash.js'

export {
  HttpTransport,
  IDENTIFY_PATH,
  SDK_KEY_HEADER,
  TransportError,
  type HttpTransportOptions,
  type SubmitResponse,
  type Transport,
} from './transport.js'

export {
  outcomeOf,
  SOURCE,
  statusOf,
  valueOf,
  wasBlocked,
  type AudioSignal,
  type AutomationSignal,
  type BatterySignal,
  type CanvasSignal,
  type ColorGamutSignal,
  type DomBlockersSignal,
  type EngineSignal,
  type ErrorsSignal,
  type FontsSignal,
  type FontPreferencesSignal,
  type HardwareSignal,
  type IntlSignal,
  type MathSignal,
  type MediaDevicesSignal,
  type MediaQueriesSignal,
  type NavigatorSignal,
  type LanguagesSignal,
  type PluginsSignal,
  type PluginSignal,
  type PluginMimeTypeSignal,
  type NetworkSignal,
  type PermissionsSignal,
  type ScreenSignal,
  type ScreenFrameSignal,
  type SensorsSignal,
  type ShieldsSignal,
  type SourceId,
  type StorageDurabilitySignal,
  type StorageSignal,
  type SpeechSignal,
  type SpeechVoiceSignal,
  type TimezoneSignal,
  type TimingSignal,
  type TouchSignal,
  type VendorSignal,
  type WebGLSignal,
} from './signals.js'

export {
  BRAVE_SYNTHETIC_QUOTA,
  detectAll,
  detectAutomation,
  detectEmulator,
  detectFarm,
  detectIncognito,
  detectShields,
  detectTor,
  farblesFingerprints,
  trustedDeviceMemory,
  unknown,
  weigh,
  type Evidence,
} from './detect/index.js'

export { SDK_VERSION } from './version.js'

// The native vocabulary. Exported from the kernel rather than from each mobile
// package so that the types a React Native app sees and the types a Flutter
// binding names are the same ones, from the same place.
export type {
  AndroidVerdicts,
  IosVerdicts,
  MobileVerdicts,
  NativeIdentifyResult,
  NativeVerdicts,
} from './types.js'

export type * from './types.js'
