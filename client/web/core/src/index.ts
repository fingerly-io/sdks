/**
 * @fingerly/core - the framework-agnostic kernel every Fingerly SDK is built on.
 */

export { FingerlyClient, resetEmbeddingWarning, SCHEMA_VERSION } from './client.js'
export type { CollectOptions, FingerlyClientOptions, IdentifyOptions } from './client.js'
export { DEFAULT_ENDPOINT } from './routing.js'
export { ConsentError } from './consent.js'
export { SEAL_STORAGE_KEY } from './continuity.js'

export { collect, DEFAULT_BUDGET_MS } from './scheduler.js'
export type { ScheduleOptions, ScheduleResult } from './scheduler.js'

export {
  BlockedSignal,
  reasonOf,
  TimedOutSignal,
  UnsupportedSignal,
  type Source,
  type SourceContext,
  type SourceOptIn,
  type SourceStage,
} from './source.js'

export { hash64 } from './hash.js'
export { hasOwn, own, ownCopy } from './own.js'

export {
  HttpTransport,
  NO_SECURE_RANDOM_CODE,
  SDK_KEY_HEADER,
  TransportError,
  type HttpTransportOptions,
  type SubmitResponse,
  type Transport,
} from './transport.js'

export {
  EMBEDDED_SAFE_SOURCES,
  outcomeOf,
  SOURCE,
  statusOf,
  valueOf,
  wasBlocked,
  type ApplePaySignal,
  type AudioSignal,
  type AutomationSignal,
  type CanvasSignal,
  type CodecsSignal,
  type ColorGamutSignal,
  type EmbeddingSignal,
  type EngineSignal,
  type ErrorsSignal,
  type FontsSignal,
  type FontPreferencesSignal,
  type HardwareSignal,
  type IntlSignal,
  type LanguagesSignal,
  type MathSignal,
  type MediaDevicesSignal,
  type MediaQueriesSignal,
  type NavigatorSignal,
  type NetworkSignal,
  type PermissionsSignal,
  type ScreenFrameSignal,
  type ScreenSignal,
  type ShieldsSignal,
  type SourceId,
  type StorageDurabilitySignal,
  type StorageSignal,
  type TimezoneSignal,
  type TimingSignal,
  type TouchSignal,
  type VendorSignal,
  type VoicesSignal,
  type WebGL2Signal,
  type WebGLSignal,
  type WebGPUSignal,
  type WorkerRealmSignal,
} from './signals.js'

export { isSuspiciousLevel } from './suspicion.js'

export { SDK_VERSION } from './version.js'

export type { NativeIdentifyResult } from './types.js'
export type * from './types.js'
// Runtime constants for the closed string sets in the contract.
export {
  Confidence,
  ConsentState,
  Continuity,
  EventState,
  IncognitoDetection,
  SdkPlatform,
  Signal,
  SuspectLevel,
} from '@fingerly/types'
