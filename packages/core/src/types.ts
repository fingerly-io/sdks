/**
 * The shapes every Badele SDK speaks in.
 *
 * Nothing here touches the DOM. A type that only a browser can populate still
 * belongs in this file, because the server and the mobile SDKs both need to
 * name it; what does not belong here is the code that reads a `window`.
 */

/** Which SDK collected a report. Mirrors `schemas.SDKInfo` on the server. */
/**
 * The cross-platform values name the host as well as the toolkit, because the
 * server maps an SDK platform onto one of three scoring profiles by looking for
 * `ios` or `android` in the string — see `models.RiskPlatformFor`. A React
 * Native app reporting only `react-native` falls through to the browser
 * profile, where `jailbreak` is not a signal at all and everything the native
 * SDK went to the trouble of collecting is worth nothing.
 */
export type SdkPlatform =
  | 'web'
  | 'android'
  | 'ios'
  | 'react-native-ios'
  | 'react-native-android'
  | 'flutter-ios'
  | 'flutter-android'

/**
 * How a source finished.
 *
 * This is the deliberate departure from another library, which collapses every
 * failure into one `error` token - so a browser that lacks an API, a privacy
 * extension that blocked it, and a throttled tab that ran out of time all hash
 * identically. They are three different facts about a visitor:
 *
 * - `ok`          the source produced a value.
 * - `unsupported` the API is not present. A property of the device/browser.
 * - `blocked`     the API is present and refused, or returned deliberate noise.
 *                 A property of the visitor's privacy posture, and most of what
 *                 Tor and hardened-browser detection is made of.
 * - `timeout`     the source overran its slice of the budget. Says something
 *                 about load and throttling, and nothing about the device.
 * - `error`       the source threw for a reason we did not anticipate.
 */
export type SignalStatus = 'ok' | 'unsupported' | 'blocked' | 'timeout' | 'error'

/**
 * What one source reported.
 *
 * `ms` is recorded for every status, failures included. A source that took
 * 3ms to be unsupported and one that took 300ms to be blocked are telling
 * different stories, and the duration is frequently the more stable of the two
 * numbers - timing is itself an entropy source, which is why it is kept rather
 * than discarded on the failure path.
 */
export interface SignalOutcome<T = unknown> {
  status: SignalStatus
  /** Wall-clock milliseconds the source occupied, rounded to avoid a clock oracle. */
  ms: number
  /** Present when `status` is `ok`. */
  value?: T
  /**
   * Why, for the statuses that have a why. A short stable token such as
   * `SecurityError` or `audio-suspended` - never a stack trace, which is
   * unstable across versions and would poison any matching built on it.
   */
  reason?: string
}

/**
 * When a source runs.
 *
 * `fast` sources are cheap and synchronous-ish, and every one of them must fit
 * inside the fast budget because a page is waiting on the submission. `deferred`
 * sources are the expensive ones - font measurement, audio rendering, WebGL
 * shader precision - which are worth having but not worth blocking a checkout
 * button for.
 */
export type SourceTier = 'fast' | 'deferred'

/** A native function, descriptor or prototype that is not what it should be. */
export interface Lie {
  /** Stable identifier, such as `navigator.hardwareConcurrency.getter`. */
  id: string
  /** What kind of tampering was observed. */
  kind: 'not-native' | 'descriptor' | 'prototype' | 'contradiction' | 'missing'
  /** Optional short detail. Kept stable across versions or left off. */
  detail?: string
}

/**
 * What the browser is, as opposed to what it says it is.
 *
 * `claimed` comes from the user-agent and the UA-CH headers - a string anyone
 * can set. `observed` is derived from engine behaviour that a spoofer has to
 * patch a JS builtin to change, at which point `lies` catches them instead.
 * A disagreement between the two is worth more than either one alone.
 */
export interface EngineIdentity {
  claimed?: string
  observed?: string
  agrees?: boolean
}

/** The tamper layer's findings. Raw; the server decides what they are worth. */
export interface IntegrityReport {
  /** Natives whose `toString()` is no longer `[native code]`. */
  patched_natives: string[]
  /** Everything else that did not add up. */
  lies: Lie[]
  engine: EngineIdentity
}

/**
 * The whole client-side observation, as submitted.
 *
 * This is what lands in `signals` on the wire. The server types that field as
 * `map[string]any` and deliberately does not interpret it (see
 * `server/services/identify.go`), so this interface is the only place the
 * shape is written down until the event store exists.
 */
export interface SignalReport {
  /** Bumped when a field changes meaning, never when one is added. */
  schema: number
  /** The budget that was asked for, so a truncated report is legible as one. */
  budget_ms: number
  /** What collection actually cost. */
  elapsed_ms: number
  /** Which tiers ran. A fast-only report is not a degraded full one. */
  tiers: SourceTier[]
  sources: Record<string, SignalOutcome>
  integrity: IntegrityReport
}

/** How sure a verdict is. Matches the server's `*_confidence` fields. */
export type Confidence = 'low' | 'medium' | 'high'

/**
 * One detector's answer.
 *
 * `reasons` is the point of this type. A boolean that cannot say why it is
 * true is not reviewable, and every one of these verdicts will eventually be
 * argued with by a customer looking at a blocked user.
 */
export interface Verdict {
  value: boolean
  confidence: Confidence
  reasons: string[]
}

/**
 * The verdicts the client can reach on its own.
 *
 * These are computed in the page for the caller's convenience - a login form
 * that wants to step up to MFA should not have to wait for enrichment. They
 * are *not* authoritative: the same functions run again on the server, over
 * the stored report, with rules that can improve without an SDK release. A
 * client-side verdict is advice; the server's is the answer.
 */
export interface Verdicts {
  incognito: Verdict
  tor: Verdict
  emulator: Verdict
  automation: Verdict
  /**
   * Device farms are fundamentally a server-side finding - N identical devices
   * behind one ASN - so this verdict only reports the client-observable half:
   * a device that looks mass-provisioned or reset-fresh.
   */
  farm: Verdict
}

/**
 * The verdicts a native application can reach, on either platform.
 *
 * Separate from [[Verdicts]] rather than an extension of it, because the two
 * sets barely overlap. A page approximates `emulator` from a software renderer
 * and a suspicious pixel ratio; an app reads `SIMULATOR_ROOT` out of its own
 * environment and knows. A browser cannot look for an injected library at all.
 * Folding them into one interface would mean every field optional, which would
 * make "this platform cannot answer that" and "that answer was false" the same
 * value — the distinction the whole `SignalStatus` design exists to preserve.
 */
export interface NativeVerdicts {
  /** Frida, Substrate, Substitute, ElleKit — anything rewriting the process. */
  instrumentation: Verdict
  /** Something intercepting the app's own TLS. */
  mitm: Verdict
  /** A debugger or a UI-test runner driving the process. */
  automation: Verdict
  /** Hooked functions, injected images, a signature that is not the app's. */
  tampering: Verdict
  /**
   * A device that looks mass-provisioned or reset-fresh.
   *
   * The half one device can see about itself: no passcode, no biometry
   * enrolled, every setting at its factory default, an empty disk. The
   * conclusive half — N identical devices behind one address — is the server's.
   */
  farm: Verdict
}

/** What an iOS device can be asked. */
export interface IosVerdicts extends NativeVerdicts {
  jailbreak: Verdict
  simulator: Verdict
}

/** What an Android device can be asked. */
export interface AndroidVerdicts extends NativeVerdicts {
  root: Verdict
  emulator: Verdict
  /** An app running under a cloning framework — one device, a hundred accounts. */
  appCloner: Verdict
}

/**
 * Both platforms' verdicts in one shape, as the cross-platform SDKs return them.
 *
 * Not `IosVerdicts | AndroidVerdicts`. The union is more honest about the
 * difference and it makes every call site narrow on the platform before it can
 * read a field — which is the wrong trade for a binding whose entire purpose is
 * writing the check once. `if (verdicts.jailbreak.value)` in code that runs on
 * both platforms is the normal case, not the exception.
 *
 * The distinction is not lost, only moved. A member the platform cannot answer
 * comes back as `{ value: false, confidence: 'low', reasons: [] }` — an empty
 * `reasons` beside a false is what "this could not be asked" looks like, and it
 * is the same convention `unknown()` uses in every detector in this codebase. A
 * caller that needs to tell "we looked and found nothing" from "there was
 * nothing to look at" reads `reasons.length`.
 *
 * The narrow types above remain, for a caller that has already established
 * which platform it is on and wants the compiler to know.
 */
export interface MobileVerdicts extends NativeVerdicts {
  /** iOS. Unknown on Android. */
  jailbreak: Verdict
  /** iOS. Unknown on Android. */
  simulator: Verdict
  /** Android. Unknown on iOS. */
  root: Verdict
  /** Android. Unknown on iOS. */
  emulator: Verdict
  /** Android. Unknown on iOS. */
  appCloner: Verdict
}

/** What a native `identify()` resolves with. See [[IdentifyResult]]. */
export interface NativeIdentifyResult {
  requestId: string
  verdicts: MobileVerdicts
  report: SignalReport
}

/** A submission, as the body of `POST /api/v1/identify`. */
export interface IdentifySubmission {
  sdk: { platform: SdkPlatform; version: string }
  signals: SignalReport
  tag?: string
}

/**
 * The receipt. `202 Accepted` from the server; see `schemas.IdentifyOut`.
 *
 * Note what is absent: there is no visitor identifier here, because the client
 * does not compute one. another library hashes its components in the page, which
 * makes the identity forgeable by the visitor and freezes the matching
 * algorithm into whatever SDK version a customer deployed. Badele submits the
 * raw report and lets the server decide who this is.
 */
export interface IdentifyResult {
  requestId: string
  /** The local verdicts, available immediately. Advisory; see [[Verdicts]]. */
  verdicts: Verdicts
  /** The report that was sent, for debugging and for offline callers. */
  report: SignalReport
}

// ---------------------------------------------------------------------------
// The enriched event.
//
// Fetched by `requestId` after the server has done the work that cannot happen
// in tens of milliseconds - IP geolocation, the velocity windows, the proxy
// and VPN verdicts. None of this is produced client-side; the types live here
// because every SDK has to name them.
// ---------------------------------------------------------------------------

export interface IdentificationConfidence {
  score: number
  version: string
}

export interface Identification {
  visitor_id: string
  confidence: IdentificationConfidence
  visitor_found: boolean
  first_seen_at: number
  last_seen_at: number
}

export interface IpGeolocation {
  accuracy_radius: number
  latitude: number
  longitude: number
  postal_code: string
  timezone: string
  city_name: string
  country_code: string
  country_name: string
  continent_code: string
  continent_name: string
  subdivisions: { iso_code: string; name: string }[]
}

export interface IpInfoV4 {
  address: string
  geolocation: IpGeolocation
  asn: string
  asn_name: string
  asn_network: string
  asn_type: string
  datacenter_result: boolean
}

export interface VelocityWindow {
  '5_minutes': number
  '1_hour': number
  '24_hours': number
}

export interface Velocity {
  distinct_ip: VelocityWindow
  distinct_country: VelocityWindow
  events: VelocityWindow
  ip_events: VelocityWindow
}

/** Fields every platform reports. */
export interface BadeleEventBase {
  event_id: string
  timestamp: number
  source: 'device'
  sdk: { platform: SdkPlatform; version: string }
  replayed: boolean
  identification: Identification
  ip_address: string
  ip_info: { v4: IpInfoV4 }
  proxy: boolean
  proxy_confidence: Confidence
  vpn: boolean
  vpn_confidence: Confidence
  tampering: boolean
  tampering_confidence: Confidence
  suspect_score: number
  velocity: Velocity
}

/**
 * Signals only a native app can observe.
 *
 * Absent on web rather than `false`, because a browser cannot look for a root
 * app and reporting "no" would be a claim nobody made.
 */
export interface BadeleMobileEvent extends BadeleEventBase {
  sdk: { platform: 'android' | 'ios'; version: string }
  package_name: string
  emulator: boolean
  root_apps: boolean
  cloned_app: boolean
  frida: boolean
  developer_tools: boolean
  factory_reset_timestamp?: number
  active_call: boolean
}

export interface BadeleWebEvent extends BadeleEventBase {
  sdk: { platform: 'web'; version: string }
  browser_name: string
  browser_version: string
  incognito: boolean
  ad_blocker: boolean
}

export type BadeleEvent = BadeleMobileEvent | BadeleWebEvent
