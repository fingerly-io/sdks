# What the SDKs collect

Written for the integrator, and for the privacy notice they have to write.

If you are embedding a Fingerly SDK, you are the controller for the data it
collects about your visitors and we are your processor. That means the notice,
the legal basis and the consent are yours to get right, and you cannot do any
of it without knowing exactly what the code reads, stores and sends. This
document is that list, checked against the `0.4.0` SDKs (`v: 3` wire protocol)
on 2026-11-16.

> **Read §4 before shipping to visitors in the EU or UK.** Every SDK has a
> `consent` option. It defaults to `pending`, so an integration that does
> nothing collects nothing, and the server refuses any submission not sent
> with consent granted. Granting it is your call, and your responsibility.

## 1. The short version

The SDKs read characteristics of the device and browser in order to judge
whether it is being misrepresented. How the same device is recognised across
visits differs by platform:

- **Browsers** are recognised by their device and browser characteristics in a
  single-pass `v: 3` collection (§2). A page running inside an app is never
  fingerprinted (§3.3); the browser SDK is not for apps.
- **Native apps** (iOS, Android, and the React Native, Flutter and Lynx
  bridges) are recognised **only** by the random UUIDv4 `install_id` the SDK
  stores inside the app's own container (§3.1). Hardware, operating system and
  cryptographic attestation signals are never used to recognise a device or a
  user in an app; they serve integrity checks and scoring only. A native report
  without an `install_id` identifies nobody.

The SDKs never trigger any user-visible permission prompt, OS alert, lockscreen
or biometric prompt, clipboard toast, or privacy indicator (**Rule #1**). They
do not read page content, form fields, keystrokes, mouse movement, clipboard,
contacts, photos, location services, or anything belonging to the person rather
than to the device.

What leaves the device is a single-pass `v: 3` envelope carrying raw signal
measurements (plus a hardware signature on native mobile). What we add
server-side is an IP-derived, approximate location and network classification,
a visitor identifier (`visitor_id`, or `""` when unidentifiable) and a risk
score. By default the browser SDK leaves nothing behind on the device; with
session continuity turned on it keeps one value in `sessionStorage` for the
life of the tab (§2.1). The mobile SDKs
keep one container-scoped `install_id` and a local hardware attestation signing
key (§3.1), both of which the app can atomically delete (§3.2) and both of
which are removed if the user uninstalls the app.

## 2. Browser (`@fingerly/core`, `@fingerly/web-js` `0.4.0` and framework bindings)

Collection runs in a **single pass** (`1-RTT` submission to `POST /api/v1/ingest`
with `v: 3`, retiring `/api/v1/ingest/supplement` and `deferred_token`) under a
350 ms default Stage 2 collection budget (`< 80ms` typical p50/p95 before
network RTT; on a browser that has just started, the identity-critical audio,
voice and codec sources may run up to 400 ms past it, and a `budgetMs` the
caller sets is a hard ceiling). Internally, the browser scheduler executes two stages before
sending one request:

1. **Stage 1 (`prerequisite`)**: Runs `engine` detection and, exclusively on
   Gecko engines (`engine === 'gecko'`), a bounded `<= 3ms` (`2.5ms–3.0ms`)
   single-tick `performance.now()` clamping probe (`0.0ms` overhead on WebKit
   and Blink). Whenever Gecko timer resolution is clamped (`delta == 0` within
   `3.0ms` or `delta >= 1.5ms`), both `shields` and `canvas` skip every pixel
   readback (`getImageData`, `toDataURL`, `toBlob`, `convertToBlob`,
   `readPixels`) and report `status: "blocked", reason: "rfp-canvas-prompt-avoided"`,
   guaranteeing zero Firefox `resistFingerprinting` (RFP) or Tor Browser canvas
   permission doorhangers.
2. **Stage 2 (`collect`)**: Runs the remaining collectors concurrently within
   the `350ms` budget, followed by the synchronous `lies/` tamper check.

| Group | Sources | What they read |
|---|---|---|
| Engine | `engine`, `math`, `errors` | How the JavaScript engine behaves: error grammar lengths, built-in `eval` length, stack style, CSS `@supports` engine-exclusive grammar (`-moz-appearance`, `-webkit-touch-callout`), structural `typeof DeviceMotionEvent?.requestPermission === 'function'` check (never invoked), and FDLIBM math probes |
| Worker realm | `worker_realm` | CSP-safe isolated `Blob` Web Worker (`60ms` timeout) reading `navigator.{userAgent, platform, hardwareConcurrency, deviceMemory, languages}`, `Intl` timezone, and `OffscreenCanvas` WebGL unmasked vendor/renderer to cross-check the main `Window` realm |
| Navigator & client hints | `navigator`, `user_agent_data`, `languages`, `vendor`, `plugins` | User agent, platform, vendor, CPU cores, device memory, touch points, `webdriver`, cookie and PDF viewer flags, Do Not Track, languages, plugin list, and UA Client Hints (`architecture`, `bitness`, `model`, `platform_version`, brands) |
| Display | `screen`, `screen_frame`, `media_queries`, `color_gamut` | Screen and window geometry, colour depth, pixel ratio, orientation, and preference media queries (forced colours, reduced motion, contrast, HDR, gamut) |
| Rendering | `canvas`, `webgl`, `webgl_extensions`, `shields` | Shared offscreen `<canvas>` raw-RGBA geometry/text digest and farbling/noise check (gated on Gecko by the `<= 3ms` RFP timer guard), WebGL vendor/renderer strings, parameters/shader precision hashes, and supported extensions |
| Audio | `audio`, `audio_latency` | `OfflineAudioContext` rendering digest and output base latency |
| Text | `fonts`, `font_preferences` | Installed standard font availability (inferred from text width measurements, never `queryLocalFonts()`) and default font family widths |
| Device & locale | `hardware`, `touch`, `media_devices`, `network`, `intl`, `timezone` | Cores and memory, touch/pointer capability, the **count** of audio/video input and output devices via `enumerateDevices()` (never requesting access, so labels remain hidden), connection speed estimates, time zone, locale, calendar and number formatting |
| Storage | `storage`, `storage_quota`, `storage_durability` | Whether `localStorage`, `sessionStorage`, IndexedDB, service workers and OPFS are available, storage quota/usage estimates, and—**strictly opt-in** when `incognitoDetection: 'extended'` is passed on Chromium `>= 152`—IndexedDB relaxed-vs-strict commit timing (`<= 60ms`) |
| Runtime & embedding | `timing`, `permissions`, `automation`, `embedding` | Clock resolution, read-only `Notification` and `geolocation` permission **states** (never prompting), WebDriver/CDP/Playwright/Selenium automation globals, and in-app WebView environment markers |

Retired browser sources (`speech`, `sensors`, `battery`, and `dom_blockers`)
have been deleted from `@fingerly/core` and `@fingerly/web-js` `0.4.0`: the SDK
no longer enumerates speech synthesis voices, motion sensor events, battery
levels, or content-blocker DOM filter lists.

After collection, `lies/` inspects built-in prototypes, getters (`Proxy` and
`.bind()` wrappers, throwing `toString` hooks, and WebIDL invalid-receiver
`TypeError` brand checks) against module-init intrinsics and a fresh same-origin
iframe realm. It reads no new user data.

Things worth stating plainly for privacy reviewers:

- **Nothing prompts the visitor (Rule #1).** `permissions` queries permission
  state without prompting, `media_devices` calls `enumerateDevices()` without
  `getUserMedia()`, `DeviceMotionEvent.requestPermission` is checked by
  `typeof` only and never invoked, `queryLocalFonts()` is never called, and
  Gecko RFP / Tor Browser sessions skip canvas readback before touching any
  canvas pixel API (`rfp-canvas-prompt-avoided`).
- **`storage_durability` is off by default.** Default `identify()` performs zero
  IndexedDB durability `fsync` rounds; `storage_durability` runs only when the
  integrator explicitly passes `incognitoDetection: 'extended'`.
- **Hardened and private browsers are not coerced into shared IDs.** Verified
  Brave Shields farbling and Tor Browser / Firefox RFP are never matched or
  minted: the server answers `identifiable: false`, `visitor_id: ""`,
  `visitor_is_new: false`, `visitor_confidence: 0`, writes zero PostgreSQL
  visitor rows, and exempts `fingerprint_suppressed`. A Safari private window
  is recognised as the visitor seen in a normal window when the browser's
  configuration is distinctive enough to tell it from other devices, and that
  answer carries a `visitor_confidence` below `100`. Otherwise it is answered
  the same way as the hardened browsers: `identifiable: false`, an empty
  `visitor_id`, zero visitor rows, and no `fingerprint_suppressed`.

### 2.1 What the browser SDK writes

By default, nothing that outlives the call. It writes no cookies, sends no
cookies (`credentials: 'omit'`), and keeps no identifier on the device:

- `storage` writes and immediately deletes a `__fingerly_probe__` key in
  `localStorage` and `sessionStorage` to test writability;
- `worker_realm` creates an in-memory `Blob` Worker URL (skipped automatically
  when `<meta http-equiv="Content-Security-Policy">` disallows `blob:` workers,
  and memoized if a `SecurityError` occurs), explicitly releases its
  `OffscreenCanvas` WebGL context (`WEBGL_lose_context.loseContext()`),
  terminates the worker, and revokes the `Blob` URL in `finally`;
- `storage_durability`, **only when `incognitoDetection: 'extended'` is passed**
  on Chromium `>= 152`, creates a temporary `__fingerly_durability_<random>`
  IndexedDB database (`<= 4` pairs × `3` rounds, `<= 60ms`) and deletes it
  immediately.

**Session continuity (`continuity: 'session'`, off by default).** A page that
turns this option on keeps exactly one value in the browser:

- **Where.** `sessionStorage`, under the single key `__fingerly_seal__`. Never
  `localStorage`, a cookie, IndexedDB or `window.name`. `sessionStorage` is
  scoped to one tab and one origin, and the browser discards it when the tab
  closes.
- **What.** A session seal: a token signed by Fingerly that names the visitor
  the platform already answered this tab with, together with the time it stops
  being accepted. It is not a device identifier chosen by the browser. The SDK
  cannot create or alter one, and the server honours it only for the project,
  the page origin and the browser profile it was issued to.
- **When.** A seal is issued only for a private window that was identified. It
  is accepted for 30 minutes, each answer that honours it carries the next
  one, and a session ends 12 hours after its first seal at the latest. An
  answer that carries no seal removes the stored one.
- **Consent.** The value is read and written only while consent is `granted`.
  `setConsent('denied')` removes it immediately, and it is never read while
  consent is `pending`.

With `continuity: 'none'` (the default) none of this happens: no storage is
read or written for it and no seal is requested.

Reading device characteristics remains in scope for ePrivacy Art. 5(3) whether
or not persistent storage is written (§4). Keeping the session seal is storage
access under ePrivacy Art. 5(3) as well, and is covered by the same consent the
SDK already requires before it reads anything.

## 3. Mobile (`ios`, `android` `0.4.0`, and the React Native, Flutter and Lynx bridges)

The native SDKs read operating system and hardware characteristics, app
installation details, security state and runtime integrity indicators, and sign
the exact UTF-8 `signals` wire bytes with hardware-backed keys in a `1-RTT`
steady-state `v: 3` request. None of those hardware, OS or attestation signals
is ever used to recognise the device or link `visitor_id` (§1); they serve
integrity verification and fraud scoring only.

**iOS (`Fingerly` `0.4.0`, 15 sources)**

- Machine & OS (`system`, `hardware`, `display`, `sensors`, `intl`): model
  identifier (`hw.machine` / `uname`), Metal GPU capability tier
  (`gpu_family_max` `1..9` via public `MTLCreateSystemDefaultDevice()`), screen
  geometry and scale, boolean presence of accelerometer and gyroscope hardware
  (never starting sensor updates), time zone and locale.
- App & container (`app`, `storage`, `identity`): bundle ID, version, signing
  and receipt/provisioning booleans, container age in whole days
  (`container_age_d`), and the container-stored UUIDv4 `install_id`, launch
  count and install age.
- Security & network (`security`, `network`, `tls`): whether a passcode is set
  and biometry availability state (never evaluating a policy or prompting),
  path transport (`NWPathMonitor`), interface types (`utun`/cellular), HTTP/PAC
  proxy flags, radio service count, and the shared `HttpTransport` TLS
  certificate chain's trust-anchor SPKI SHA-256 (`root_key_sha256`).
- Runtime integrity (`jailbreak`, `debugger`, `instrumentation`, `images`, plus
  `FingerlyPtrAuth`): read-only file/symlink existence checks (`access`,
  `lstat`; `readlink` is retired), loaded Mach-O image classification via
  public `_dyld_shared_cache_contains_path`, loopback port probe (`127.0.0.1`
  only), ARM64e PAC-stripped `__got` / `__auth_got` / `__la_symbol_ptr` slot
  checks, prologue `w0..w3` branch inspection, and Objective-C singleton ISA /
  `_objc_msgForward` swizzle checks (zero inline `svc #0x80` syscalls).
- Platform attestation (`attest` envelope): Apple App Attest key attestation
  and assertion over the framed `v: 3` request digest, plus an optional
  ephemeral Apple `DCDevice` `device_token` **only** when the customer has
  uploaded an Apple credential with `device_check_enabled: true` and the
  server's challenge explicitly requests it.
- **Not read at all (ADR 0001):** `identifierForVendor`, boot time
  (`KERN_BOOTTIME` / `systemUptime`), disk capacity or free space (`statfs`),
  `UserDefaults`, `UIPasteboard`, battery monitoring, accessibility feature
  states, audio routes, installed font counts, or carrier names.

**Android (`io.fingerly:fingerly` `0.4.0`, 20 sources, pure Kotlin, zero `.so`)**

- Machine, OS & settings (`system`, `hardware`, `display`, `storage`, `sensors`,
  `audio`, `intl`, `accessibility`, `battery`, `security`): OS version,
  security patch level, verified-boot properties, SoC/board/ABIs/RAM, display
  geometry, free storage ratio, boolean sensor presence and whether all sensors
  are AOSP-vendored (`only_platform_vendors`, never raw vendor lists), audio
  routing, locale/timezone, accessibility scale/timeout counts, one boolean
  saying whether any accessibility service is enabled (never which services;
  the server uses it only as one hint that the device's settings were changed
  at some point, so it never raises a score and is never scored as
  automation), battery state, and whether a lockscreen or biometry hardware is present (never
  prompting).
- App, network & TLS (`app`, `identity`, `network`, `tls`): package name,
  version code, 64-hex signing certificate SHA-256, installing store,
  `noBackupFilesDir` UUIDv4 `install_id`, active network transports (VPN over
  cellular), HTTP proxy state, and the shared `HttpTransport` TLS chain's
  validated trust-anchor SPKI SHA-256 (`root_key_sha256`) and user CA count.
- Runtime & profile integrity (`root`, `emulator`, `debugger`,
  `instrumentation`, `images`, `cloned`, plus `Integrity.kt`): root binaries,
  `/proc/self/mountinfo` overlay/Magisk/KernelSU/APatch mounts,
  `/proc/self/maps` `memfd:` and `/dev/` executable mappings (never reading
  `/sys/fs/selinux/enforce`), `Os.access` vs `File.exists` mismatch and
  `FileFilter` stack-frame hook inspection, all-overload reflection across 15
  pure-Java framework methods (`Integrity.kt`), and zero-permission
  `UserManager.isManagedProfile` / `context.isDeviceProtectedStorage` checks to
  distinguish managed enterprise Work Profiles from app cloners.
- **Optional sibling modules (`<queries>` and Play Services isolated out of core):**
  - Core `io.fingerly:fingerly` declares **zero `<queries>`** package entries
    and **zero Google Play Services dependencies**.
  - `io.fingerly:fingerly-app-checks` (optional): adds the 17 specific root,
    hook and cloner `<queries>` package declarations (never
    `QUERY_ALL_PACKAGES`) so `AppChecksProvider` can report boolean presence
    (`root_manager_installed`, `hook_manager_installed`, `cloner_installed`);
    no package name ever leaves the device.
  - `io.fingerly:fingerly-play-integrity` (optional): requests a Google Play
    Integrity standard token bound to `requestHash = hex(statementDigest)` only
    when the customer configures a Google Cloud project and the server's
    challenge offers `play_integrity: true`.

The React Native (`@fingerly/react-native` `0.4.0`), Flutter
(`fingerly_flutter` `0.4.0`) and Lynx (`@fingerly/lynx` `0.4.0`) packages are
thin bridges over the native iOS and Android `0.4.0` SDKs.

### 3.1 What the mobile SDKs store and send

| | iOS (`0.4.0`) | Android (`0.4.0`) |
|---|---|---|
| Identity & key state stored on the device | Files under `Application Support/io.fingerly.sdk/` protected with `FileProtectionType.completeUntilFirstUserAuthentication` and `isExcludedFromBackup = true`, holding the random UUIDv4 `install_id`, launch count, first-seen timestamp, and App Attest key state (`keyId`, `pending`, replacement backoff). **Zero Keychain storage** and **zero `UserDefaults`**: uninstalling the app removes all stored state | One file, `io.fingerly.sdk.install`, under `context.noBackupFilesDir`, holding the random UUIDv4 `install_id`, first-seen time, launch count, signing certificate digest, and 24-hour attestation key lease metadata, plus one hardware-backed EC P-256 signing key in `AndroidKeyStore` (`alias = "io.fingerly.sdk.attest.v3"`). Never backed up, and **removed on uninstall** |
| Hardware signing key lifecycle | Per-install Secure Enclave App Attest key (`DCAppAttestService`), replaced only on `deleteStoredIdentity()` or server `rekey_required` / `attestation_key_unknown` (with `0d -> 7d -> 14d -> 30d` storm backoff). Never linked to `visitor_id` | **24-hour TEE EC P-256 signing key lease** (`alias = "io.fingerly.sdk.attest.v3"`). Signs the `v: 3` framed preimage locally in ~3–8ms (`SHA256withECDSA`) without per-call key creation/deletion, and rotates every 24 hours (or on OS patch change / `deleteStoredIdentity()`). **Never** linked to `visitor_id`, **never** requests hardware serial/IMEI IDs (`setDevicePropertiesAttestationIncluded` is never called), and **never** prompts for lockscreen/biometrics (`setUserAuthenticationRequired` is never called) |
| How the server recognises the device | By `install_id` only | By `install_id` only |
| Platform hardware/vendor IDs sent | **None** (`identifierForVendor` is not read or sent) | **None** (`ANDROID_ID`, IMEI and hardware serials are not read or sent) |
| Calls other than to Fingerly | Apple App Attest (`attestKey` once per key; assertions are local) and optional `DCDevice.generateToken` when `device_check` is offered | Local TrustZone/TEE `AndroidKeyStore` key generation (once per 24h lease); optional Google Play Integrity `StandardIntegrityManager` only when `:fingerly-play-integrity` is installed and offered |
| TLS inspection | Shared `HttpTransport` inspects the live/pooled HTTPS connection's validated trust-anchor SPKI SHA-256 (`root_key_sha256`, keyed by `(host, port, activeNetworkHandle)`)—no separate `HEAD /` probe | Same shared `HttpTransport` `X509TrustManagerExtensions` SPKI SHA-256 cache—no separate `HEAD /` probe |
| Permissions | None requested | `INTERNET` and `ACCESS_NETWORK_STATE` only in core `:fingerly` (**zero `<queries>`**). Optional `:fingerly-app-checks` adds the 17 named `<queries>` packages (no `QUERY_ALL_PACKAGES`) |
| Deleting the record | `Fingerly.deleteStoredIdentity()` | `Fingerly.deleteStoredIdentity(context)` |

**Enterprise MDM & Android Work Profiles (default weight `0`).** Corporate
devices frequently route TLS through an enterprise root CA or run apps inside a
managed Android Work Profile / Samsung Knox Secure Folder. Fingerly separates
these benign enterprise configurations from active attacks using two
informational signals that ship disabled at **weight `0`**:

- `custom_root_ca` (weight `0`, Android & iOS): fires when the TLS connection's
  `root_key_sha256` is trusted by the OS (`system_trusted == true`) and carries
  no interception-proxy subject tokens, but is not in the public Mozilla/CCADB
  WebPKI root set (typical of corporate MDM TLS inspection). Untrusted chains
  or known MITM proxy certificates fire `mitm_attack` instead.
- `secondary_user_profile` (weight `0`, Android): fires when the app runs in a
  managed enterprise Work Profile (`UserManager.isManagedProfile`) or secondary
  OS user profile without dual-app or cloner sandbox indicators, preventing
  false-positive `app_cloner` scores on corporate fleets.

**iOS privacy manifest.** The iOS SDK ships `PrivacyInfo.xcprivacy` in both the
SwiftPM package resources and the CocoaPods `Fingerly_Privacy` bundle:

- `NSPrivacyTracking`: `false`, and zero tracking domains (no ATT prompt).
- Collected data types (linked to the user, not used for tracking, for App
  Functionality): Device ID (`install_id`), Coarse Location (server-side city
  IP lookup), Product Interaction, Other Data Types.
- Required-reason APIs: **only** `NSPrivacyAccessedAPICategoryFileTimestamp`
  with reason **`C617.1`** (reading timestamps inside the app's own container).
  Zero `SystemBootTime` (`35F9.1`), `DiskSpace` (`E174.1`), `UserDefaults`
  (`CA92.1`), or `ActiveKeyboards` (`54BD.1`) usage.

### 3.2 Deleting the stored identity (GDPR erasure)

Every mobile SDK provides an atomic local erasure call:
`Fingerly.deleteStoredIdentity()` on iOS, `Fingerly.deleteStoredIdentity(context)`
on Android, and `deleteStoredIdentity()` in the React Native, Flutter and Lynx
bridges.

- **Intended strictly for GDPR erasure and account deletion.** Calling
  `deleteStoredIdentity()` atomically deletes **both** the local `install_id`
  container record and the local hardware attestation signing key/alias
  (`Application Support/io.fingerly.sdk/` files on iOS; `io.fingerly.sdk.install`
  and `AndroidKeyStore` alias `"io.fingerly.sdk.attest.v3"` on Android).
- **Unlinked re-consent.** It requires no initialised client, requires no
  consent, makes zero network calls, and is idempotent when no record exists.
  Set `consent` to `'denied'` first if collection must remain off afterwards.
  If the user later grants consent again, the SDK generates a fresh UUIDv4
  `install_id` and attests a fresh hardware signing key, and the server mints a
  new `visitor_id` with **zero link** to the erased `visitor_id`. (Server-side
  24-hour Redis `install_id` churn detection triggers only at `>= 3` distinct
  `install_id`s on the same hardware key within 24 hours, so legitimate GDPR
  erasure and re-consent incurs zero risk score.)
- **Server-side erasure.** Deleting device-local state does not erase historical
  events already stored on our servers; submit a visitor erasure request to us
  as well (§4).

### 3.3 Guidance for app stores & embedded WebViews

- **Do not ship the SDK in Kids Category apps** (App Store Review Guideline
  1.3) or in Google Play apps directed at children.
- **Do not embed the browser SDK in an app.** Not in an iOS/macOS `WKWebView`,
  Android `WebView`, Capacitor, Cordova, Ionic, React Native WebView, Flutter
  WebView, or Electron. Under Apple DPLA §3.3.3(B), a web page your app hosts is
  governed by the same rules as your app binary and may not derive device
  properties to uniquely identify the device. Use the native iOS or Android SDK
  (or the React Native, Flutter or Lynx bridge) instead.
- **If the browser SDK is loaded inside an app WebView anyway, it never
  fingerprints the device.** When `embedding` detects an in-app WebView,
  `@fingerly/core` skips all device-fingerprinting collectors (`canvas`,
  `audio`, `fonts`, `webgl`, `screen`, `hardware`) and runs only the DPLA-safe
  non-identifying runtime and integrity subset (`engine`, `timing`,
  `permissions`, `automation`, `math`, `errors`, `navigator`, `worker_realm`,
  `embedding`). On the server:
  - **Genuine mobile WebViews** whose runtime signals agree with a real mobile
    WebView are never matched or minted: the server keeps the event on
    `state: "enriched"` with `identifiable: false`, `visitor_id: ""`,
    `visitor_is_new: false`, `visitor_confidence: 0`, records
    `embedded_web_view` at default weight `0` alongside IP/network/velocity
    checks, and bills zero identification credits (`charge_kind = 'lookup'`).
  - **Spoofed WebView claims** (such as a desktop headless Chrome bot sending a
    forged WebView `User-Agent` or `sources.embedding` marker) contradict the
    DPLA-safe runtime probes (`Win32`/`Linux x86_64` platform, WebDriver/CDP
    globals, `SwiftShader`, or `lies`), so the server refuses the WebView
    exemption and scores full `automation`, `tampering`, and
    `device_inconsistent` detections.
- **Third-party in-app browsers are browsers.** A visitor opening your website
  from Instagram, Facebook or TikTok is browsing the web inside a third-party
  app, not yours, and is treated like any browser visitor (consent included).
- **Keys refuse app origins.** An SDK key refuses `capacitor://localhost`,
  `ionic://localhost` and `app://localhost`, and production keys refuse
  `localhost`.
- **Consent defaults to `pending`** (§4), satisfying App Store Review Guideline
  5.1.1(ii) and Google Play SDK data-safety requirements.
- **Google Play Data safety: the accessibility boolean.** The Android SDK sends
  one boolean saying whether any accessibility service is enabled on the
  device, never which services. The server uses it only as one hint that the
  device's settings were changed at some point, and it never raises a score.
  Account for it with the other device data the SDK sends (§3) when you fill
  in the Data safety form.

## 4. Consent: what you must do

Every SDK and framework binding takes a `consent` option: `'granted'`,
`'pending'` or `'denied'`, changeable at runtime via `setConsent()`.

- **It defaults to `'pending'`.** If you pass nothing, the SDK reads nothing
  and sends nothing until you call `setConsent('granted')`.
- With `'pending'` or `'denied'`, loading is inert and calling `identify()` or
  `collect()` rejects with `ConsentError` (`consent_required`) before any
  collector executes.
- Withdrawing consent mid-call aborts in-flight browser collectors and HTTP
  requests immediately; mobile SDKs re-check consent before each collector and
  before network transmission.
- With session continuity turned on in a browser (§2.1), `setConsent('denied')`
  also removes the session seal from `sessionStorage` at once.
- **The server enforces it.** Every `v: 3` submission must carry
  `"consent": "granted"`, and the API rejects anything else with `422`
  (`consent_required`).

For visitors in the EU, EEA or UK:

1. **Keep `consent: 'pending'` by default** and call `setConsent('granted')`
   only after obtaining valid consent (or establishing an applicable statutory
   exemption under ePrivacy Art. 5(3) / UK PECR Schedule A1 paragraph 4(2)(c);
   note that cross-site tracking and advertising fraud are never exempt, and
   each independent site should use its own Fingerly project because
   `visitor_id` is isolated per project when project scoping is enabled and
   never shared across organisations).
2. **Load the script after consent, or bundle the npm package** so visitors' IP
   addresses and user agents are not sent to a third-party CDN prior to consent.
3. **Disclose Fingerly as your fraud-prevention processor** in your privacy
   notice along with the retention periods in §7.
4. **Forward erasure requests to us** (and invoke `deleteStoredIdentity()` on
   mobile devices per §3.2).

## 5. First-party proxies and hosted subdomains

A **first-party proxy** (Cloudflare Worker, nginx, Caddy, Traefik/Container,
Vercel, Netlify, AWS CloudFront, Google Cloud Run, or any of the 8 Server SDK
proxy middlewares) forwards single-pass `POST /<issued_path>` (`v: 3`) raw
request bytes unchanged to `https://api.fingerly.io/api/v1/ingest` authenticated
with `x-fingerly-proxy-key`. It strips any client-spoofed `x-fingerly-*`
headers, restores only a validated `x-fingerly-sdk-platform` header (allowing
mobile apps as well as browsers to route through a first-party proxy), forwards
the browser's verbatim `Origin` (never synthesising one when missing), client IP,
`User-Agent`, `Sec-Fetch-*` / `Sec-CH-UA-Platform` (and edge TLS/HTTP protocol
metadata on Cloudflare Workers), and never forwards visitor cookies or
`Authorization` headers.

A **hosted subdomain** points a CNAME on your domain directly to Fingerly's
infrastructure with the same data minimization guarantees.

## 6. What we add server-side

| Added | Source | Note |
|---|---|---|
| IP address | The request, or an authenticated proxy (§5) | Used in memory for the local IP lookup and velocity HMAC, then discarded. Only the coarse network prefix (IPv4 `/24` or IPv6 `/40`, `ip_network`) and a keyed per-organisation HMAC digest are persisted |
| Continent, country, region, city, time zone, coarse coordinates | Fingerly's first-party local MMDB IP database | City-level at most; coordinates rounded to 1 decimal place (~11 km) internally and omitted from event API reads |
| VPN, proxy, Tor, datacenter, relay and mobile tunnel flags; abuse/attack flags; ASN | Same local first-party IP database | **Zero visitor IP addresses are ever sent to third parties**; the MMDB file is read from local disk and refreshed daily |
| Origin, `Sec-Fetch-*`, user agent, and `tag` | The request | User agent is parsed into browser/app, OS and device class |
| `visitor_id` | Minted by Fingerly (or `""` when `identifiable == false`) | Opaque 20-char random ID scoped to your organisation/project; never derived from a signal hash, never chosen by the client, and left empty (`""`, zero DB rows) on unidentifiable privacy browsers, genuine embedded WebViews, and unmatched high-risk bot traffic |
| `suspect_score`, `suspect_level`, and `triggers` | Server risk engine | Stored with the exact signal weights, confidences and reason tokens in force when evaluated (supporting GDPR Art. 22 explanations). `triggers` never leave the backend; `HideClientScore` optionally hides `suspect_score` and `suspect_level` from public SDK responses |

## 7. Retention

| Data | Kept |
|---|---|
| Events in ClickHouse (`events`), including `ip_network` and coarse city location | 30 days |
| IP network daily aggregates (`agg_ip_network_day`) | 30 days |
| Per-visitor daily aggregates (`agg_visitor_day`, filtered to `visitor_id != ''`) | 180 days |
| Aggregate analytics (`agg_*_15m` / `_hour` hot tiers, `agg_*_day` cold tiers) | 45–100 days (hot), 800 days (daily totals) |
| Short-term velocity HMAC state (Velocity Redis + ClickHouse 5m rollups) | 10 minutes in Redis, 8 days in ClickHouse |
| Visitor identity index (`visitor_identities`, `visitor_keys`) | 180 days after `last_seen`, swept hourly |
| Mobile hardware attestation key tables (`apple_app_attest_keys`, `android_attestation_keys`) | 24-hour active lease on Android (`expires_at`); rows swept 180 days after `last_seen_at` and purged immediately on organisation/project deletion (never linked to `visitor_id`) |
| Sealed Apple DeviceCheck tokens (when `device_check_enabled: true`) | At most 1 hour in Redis (`att:dc:hold:*`), never archived |
| Usage and billing ledger records | ~3 years (1,100 days in `agg_usage_day`) |
| Full submission object archive (R2 / MinIO, allow-listed fields only on native) | 30 days (bucket lifecycle rule; see ADR 0022) |

## 8. What we do not do

- No user-visible permission prompts, biometric/PIN prompts, clipboard toasts,
  or Tor Browser / Firefox RFP canvas doorhangers (**Rule #1**)
- No cookies in browsers, and by default no client-side storage outliving
  `identify()`; with session continuity turned on, one signed value in
  `sessionStorage` for the life of the tab, removed when consent is withdrawn
  (§2.1);
  mobile SDKs store only a container-scoped `install_id` and local attestation
  key state, both wiped on uninstall or `deleteStoredIdentity()` (§3.1, §3.2)
- No Keychain cross-uninstall persistence, no `UserDefaults`, and no
  `identifierForVendor` on iOS; no `ANDROID_ID`, IMEI, hardware serials, or core
  `<queries>` manifest entries on Android
- No linking of hardware attestation keys (`apple_app_attest_keys`,
  `android_attestation_keys`) to `visitor_id`
- No fingerprinting inside in-app WebViews: device-fingerprinting collectors are
  skipped on the client and genuine WebViews stay on `state: "enriched"` with
  `visitor_id: ""` on the server (§3.3)
- No shared fallback `visitor_id` collisions on masked privacy browsers (Brave
  Shields, Tor Browser, and a Safari private window that cannot be told from
  other devices return `visitor_id: ""` with zero PostgreSQL rows minted)
- No tracking (`NSPrivacyTracking = false`), no precise GPS location, no
  cross-customer identity graph, no selling or sharing of visitor data, and no
  advertising or marketing use

## 9. Related

- [`server/docs/compliance/`](../../server/docs/compliance/README.md): GDPR, ISO
  27001 and SOC 2 compliance documentation.
- [`subprocessors-and-transfers.md`](../../server/docs/compliance/subprocessors-and-transfers.md):
  infrastructure subprocessors and data residency.
- [`server/docs/attestation.md`](../../server/docs/attestation.md) and
  [`server/docs/adr/0026-platform-attestation.md`](../../server/docs/adr/0026-platform-attestation.md):
  App Attest, DeviceCheck, Android 24h key leases, and Play Integrity details.
