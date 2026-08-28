/**
 * @badele/core - the framework-agnostic kernel every Badele SDK is built on.
 *
 * It contains no browser code. The collectors live in `@badele/web-js`, and the
 * mobile SDKs bring their own, because `@badele/node` and `@badele/react-native`
 * both depend on this package and neither should carry a DOM.
 */

export { BadeleClient, SCHEMA_VERSION } from './client.js'
export type { BadeleClientOptions, IdentifyOptions } from './client.js'

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
  type CanvasSignal,
  type EngineSignal,
  type ErrorsSignal,
  type FontsSignal,
  type HardwareSignal,
  type IntlSignal,
  type MathSignal,
  type MediaDevicesSignal,
  type MediaQueriesSignal,
  type NavigatorSignal,
  type NetworkSignal,
  type PermissionsSignal,
  type ScreenSignal,
  type SensorsSignal,
  type SourceId,
  type StorageSignal,
  type TimingSignal,
  type TouchSignal,
  type WebGLSignal,
} from './signals.js'

export {
  detectAll,
  detectAutomation,
  detectEmulator,
  detectFarm,
  detectIncognito,
  detectTor,
  unknown,
  weigh,
  type Evidence,
} from './detect/index.js'

export { SDK_VERSION } from './version.js'

export type * from './types.js'
