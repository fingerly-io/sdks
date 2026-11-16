# fingerly/sdks

Client, proxy, and server SDKs (`0.3.0`, wire contract `v: 3`) for the Fingerly
fraud detection and prevention platform. This repository is the integration
workspace: independently versioned SDK repositories are mounted here as git
submodules, alongside the pnpm workspace and Turborepo.

See [`server/docs/architecture.md`](../server/docs/architecture.md) for how this
repo relates to `server` and `panels`.

## Layout

- `client/web/types`: canonical TypeScript `v: 3` wire contracts (`0.3.0`),
  maintained in the standalone private `sdk-types` repository and consumed by
  browser SDKs and TypeScript mobile bridges.
- `client/web/core`: framework-agnostic single-pass `v: 3` client kernel (`0.3.0`),
  shared by browser SDKs: the two-stage barrier scheduler (`<= 350 ms` default
  budget), consent gating, DPLA-safe embedded WebView filtering, signal
  vocabulary, and `1-RTT` transport. Contains no DOM code and compiles against
  the worker lib so that it cannot acquire any.
- `client/web/web-js`: vanilla browser SDK (`0.3.0`). The 33 single-pass browser
  sources (including the Stage 1 Gecko `<= 3 ms` RFP timer guard, CSP-safe
  `worker_realm` cross-check, and `incognitoDetection: 'standard' | 'extended'`)
  plus the tamper layer that checks whether the browser is lying about them.
- `client/web/vue`: Vue 3 plugin and composables ([README](client/web/vue/README.md)).
  One shared identification per app, readonly reactive state, SSR-safe.
- `client/web/{react,svelte,angular,nuxt,next}`: framework bindings (`0.3.0`),
  built on `@fingerly/web-js`, `@fingerly/vue`, and `@fingerly/react`.
- `client/mobile/ios`: the native iOS SDK (`0.3.0`, Swift), a private source
  repository. Customers receive the compiled `Fingerly.xcframework` via the
  Swift package [sdk-ios](https://github.com/fingerly-io/sdk-ios) or CocoaPods;
  React Native and Lynx download the same XCFramework during `pod install`,
  while Flutter supports both CocoaPods and Swift Package Manager. Uses
  `Application Support/io.fingerly.sdk/` container storage (`isExcludedFromBackup = true`,
  zero Keychain, zero `UserDefaults`), `PrivacyInfo.xcprivacy` (`C617.1` only),
  `1-RTT` App Attest + DeviceCheck raw-byte signing with ADR 0026 storm backoff,
  a shared `URLSession` TLS SPKI cache, and `FingerlyPtrAuth` ARM64e/GOT/ObjC
  probes.
- `client/mobile/android`: the native Android SDK (`0.3.0`, Kotlin), a private
  source repository. Core `io.fingerly:fingerly:0.3.0` ships one dependency
  (coroutines), no JNI, zero `<queries>` declarations, two install-time normal
  permissions that prompt nobody, a 24-hour persistent TEE EC P-256 signing key
  lease (`io.fingerly.sdk.attest.v3`) with signed `prev_key_id`/`prev_signature`
  rollover and `1-RTT` `next_attestation` caching, and a network-scoped
  `HttpsURLConnection` TLS SPKI cache. Optional sibling artifacts
  `io.fingerly:fingerly-app-checks:0.3.0` and
  `io.fingerly:fingerly-play-integrity:0.3.0` add opt-in `<queries>` package
  visibility and Google Play Integrity Standard token binding without adding
  either to core `:fingerly`. Distributed from `https://maven.fingerly.io`.
- `client/mobile/react-native`, `client/mobile/flutter`, `client/mobile/lynx`:
  standalone `0.3.0` bridges to the native SDKs, not second implementations, and
  open source under Apache-2.0. All three are thin on purpose: almost every
  signal worth having on a phone is unreachable from JavaScript or Dart, so a
  cross-platform SDK that collected only what it could reach would report a
  jailbroken, instrumented device as clean. React Native and Lynx are in the
  pnpm workspace; Flutter is a Dart/pub package and is not. Lynx supports
  Android and iOS hosts.
- `proxies/cloudflare`: first-party Cloudflare Worker proxy (`0.3.0`) forwarding
  raw-byte `POST /api/v1/ingest` submissions with sanitize-and-restore platform
  validation and edge TLS metadata forwarding.
- `server/node`: server-side Node SDK for stored-event reads, webhook
  verification, and a framework-neutral same-origin proxy. Maintained in the
  standalone private `sdk-node` repository; it has no runtime dependencies.
- `server/python`: server-side Python SDK for stored-event reads, webhook
  verification, and a same-origin proxy, mirroring the Node SDK's architecture.
  Maintained in the standalone private `sdk-python` repository. Ships a
  synchronous and an asyncio client over one shared transport, and serves the
  proxy under both ASGI and WSGI, because Python has two server standards where
  JavaScript has one `Request`/`Response`. Python 3.9+, one runtime dependency
  (`httpx`); uv and ruff for tooling.
- `server/go`: server-side Go SDK for stored-event reads, webhook
  verification, and a same-origin proxy, mirroring the Node SDK's architecture.
  Maintained in the standalone private `fingerly-go` repository, named for its
  import path rather than the `sdk-*` convention, as `stripe-go` is. Go 1.22+
  and nothing outside the standard library. The proxy is a single
  `http.Handler`, because `net/http` is the one standard every Go router takes,
  so it needs no adapters.
- `server/java`: server-side JVM SDK for stored-event reads, webhook
  verification, and a same-origin proxy, mirroring the Node SDK's architecture.
  Maintained in the standalone private `sdk-java` repository. Java 11 bytecode
  built on a 17 toolchain; `jackson-databind` is the only runtime dependency.
  Publishes four artifacts, because Java has three server standards in active
  use: `fingerly-server` plus a `-jakarta`, `-javax` and `-webflux` adapter,
  each taking its server API as `provided`. The WebFlux one offloads the
  blocking forward off the event loop.
- `server/dotnet`: server-side .NET SDK for stored-event reads, webhook
  verification, and a same-origin proxy, mirroring the Node SDK's architecture.
  Maintained in the standalone private `sdk-dotnet` repository. Two packages:
  `Fingerly.Server`, which targets net8.0 and netstandard2.0 so the reads stay
  reachable from .NET Framework, and `Fingerly.Server.AspNetCore`, which mounts
  the proxy as middleware or as routed endpoints. Zero runtime dependencies on
  net8.0, since `System.Text.Json` is in its shared framework; both packages are
  trimmable and AOT-safe, which is why every type is bound through the JSON
  source generator rather than reflection. Everything is asynchronous, with no
  synchronous counterpart.
- `server/ruby`: server-side Ruby SDK for stored-event reads, webhook
  verification, and a same-origin proxy, mirroring the Node SDK's architecture.
  Maintained in the standalone private `sdk-ruby` repository. Ruby 3.1+ and
  nothing outside the standard library. The proxy is one piece of Rack
  middleware, because Rack is the interface every Ruby server and framework
  shares, so it needs no adapters. One synchronous client and no asynchronous
  twin: `Net::HTTP` has honoured the fiber scheduler since Ruby 3.0, so the
  same client is non-blocking under Falcon. Ships RBS signatures.
- `server/rust`: server-side Rust SDK for stored-event reads, webhook
  verification, and a same-origin proxy, mirroring the Node SDK's architecture.
  Maintained in the standalone private `sdk-rust` repository. Rust 1.88+,
  async on Tokio, and the only server SDK with no dependency-free option:
  Rust has no HTTP in its standard library, so it is reqwest over rustls.
  The proxy is a `tower::Service` over `http` types rather than a set of
  framework adapters, because that is the interface axum, hyper, warp and
  tonic already share, the same reasoning that made the Go proxy one
  `http.Handler`. Everything is asynchronous, with no synchronous
  counterpart; cancellation is dropping the future. Webhook verification sits
  behind no feature, so `default-features = false` is a build with neither an
  HTTP stack nor a runtime in it.
- `server/php`: server-side PHP SDK for stored-event reads, webhook
  verification, and a same-origin proxy, mirroring the Node SDK's architecture.
  Maintained in the standalone private `sdk-php` repository. PHP 8.1+ and
  nothing outside `ext-curl` and `ext-json`; CI asserts that
  `composer install --no-dev` installs exactly zero packages and that the
  client, proxy and webhook verification all work in that state. A PSR-18
  client is accepted but never required, because requiring one means the
  package stops working unless an implementation happens to be installed.
  The proxy is one framework-neutral core plus a PSR-15, a Laravel and a
  Symfony adapter, because PHP has three live server request shapes and no
  equivalent of Rack to unify them, so this is the Java situation rather than
  the Go one. `handle()` is the interface and the adapters are conveniences,
  so Phalcon, CodeIgniter, Yii or a bare script need about ten lines.
- `contract`: API contract synced from `server`'s OpenAPI spec (`v3-envelope.md`,
  `v3-manifest.json`, `native-report.md`); the sync point for the API shape
  across every SDK and panel consumer. Server SDKs vendor snapshots so they can
  build and test independently. `node contract/sync.mjs` also copies the
  contract files the Android and iOS tests read into each repository's own
  `contract/`, and `--check` fails when a copy drifts.

## Development

Clone and fetch the submodules the JavaScript workspace needs. The native SDK sources
are private, so a full recursive clone only works with access to them:

```sh
git clone https://github.com/fingerly-io/sdks.git
cd sdks
git submodule update --init -- client/web/types server/node client/mobile/react-native client/mobile/lynx proxies/cloudflare
```

```sh
pnpm install
pnpm build
pnpm test
pnpm lint

pnpm --filter @fingerly/web-js demo   # http://localhost:4173
```

The iOS SDK is a separate toolchain and is not driven by Turborepo:

```sh
cd client/mobile/ios
swift test --filter ReadmeExamplesTests
xcodebuild test -scheme Fingerly -destination 'platform=iOS Simulator,name=iPhone 16e'
./Example/run.sh                    # builds, installs and launches on a booted simulator
```

Flutter is a separate Dart package:

```sh
cd client/mobile/flutter
flutter pub get
flutter analyze
flutter test
```

Lynx is a separate library and example app inside the pnpm workspace:

```sh
pnpm --dir client/mobile/lynx test
pnpm --dir client/mobile/lynx build
pnpm --dir client/mobile/lynx/example build
```

The demo page runs the browser SDK against whatever browser opens it and renders
the whole report: every source with its status and duration, and the tamper
measurements. It submits nothing unless an endpoint and SDK key are filled in.
Serve it over `localhost` rather than opening the file directly: several sources
need a secure context, and `file://` is not one.

Install scripts are disabled for every dependency (`.npmrc`); the reason is
written out there.

Publish the browser packages with `pnpm publish`, never `npm publish`: only
pnpm rewrites the `workspace:` ranges between them, and a tarball that still
says `workspace:*` cannot be installed. After `pnpm build`, `pnpm check:packs`
packs every browser package the way it is published and fails on a leftover
`workspace:` range, a source map, shipped sources or tests, or a missing
LICENSE or README.

## One `v: 3` envelope, three platforms

A browser, an iPhone and an Android phone submit the same single-pass `v: 3`
envelope to `POST /api/v1/ingest`: `v: 3`, `sdk`, `consent`, `signals` (a
`SignalReport` carrying `schema`, `budget_ms`, `elapsed_ms`, `sources`, and
`integrity`), optional `attest` on native mobile platforms, and optional `tag`.
What differs is which sources are in `signals.sources`.

That is what lets the server have one reader (`server/domain/risk/report.go`)
and one set of rules. The canonical TypeScript shape lives in
`client/web/types/src/index.ts`; `client/web/core` re-exports it, while
`client/mobile/ios/Sources/Fingerly/Core/Types.swift` and
`client/mobile/android/.../core/Types.kt` mirror it directly.

A native report carries raw measurements only, on the contract in
[`contract/native-report.md`](contract/native-report.md). No client holds a
weight, a threshold or a verdict: the server derives every signal from what it
received, in `server/domain/risk/native_*_rules.go`, under the customer's
weights, so a rule can change without an app update.

Hardware attestation binds the exact UTF-8 `signalsBytes` to hardware roots:
Android TEE Keystore EC P-256 signing (`io.fingerly.sdk.attest.v3` with 24-hour
lease and signed rollover, plus optional Play Integrity) and iOS Secure Enclave
App Attest + DeviceCheck raw-byte signing are verified server-side against
Google's and Apple's roots, using cached `next_attestation` challenge offers so
steady-state mobile identifications complete in **1 RTT**.

## Using it

```ts
import { load } from '@fingerly/web-js'

// Consent defaults to 'pending', which collects and sends nothing. Pass
// 'granted' only once you have consent (or know none is required for this
// visitor; see docs/privacy.md §4), or load with the default and call
// fingerly.setConsent('granted') from your consent tool.
const fingerly = await load({
  apiKey: 'fly_pk_production_…',
  consent: 'granted',
  incognitoDetection: 'standard', // or 'extended' to opt into storage_durability timing
})
const result = await fingerly.identify({ tag: 'checkout' })
const { requestId, visitorId, identifiable, suspectScore, suspectLevel } = result

// Option B: visitorId is "" whenever identifiable === false, inside an embedded
// WebView, or when an unmatched Web report is high-risk.
// suspectScore and suspectLevel can be null: not scored, or hidden by the key.
if (suspectLevel === 'high') {
  // an interface hint only: your backend reads the event and decides
}

// Local offline collection without network submission:
const localReport = await fingerly.collect()
```

Every SDK submits to `https://api.fingerly.io`. The optional
`endpoint`/`endpoints` setting always wins, which is how a customer uses the
Fingerly same-origin proxy on their own domain.

`identify()` collects and submits in **1 RTT** to `POST /api/v1/ingest`,
resolving with the server's answer: `requestId`, `visitorId`, `identifiable`,
and (unless hidden by `hide_client_score` on the key) `suspectScore` and
`suspectLevel`. Under **Option B**, `visitorId === ""` and `visitorIsNew === false`
whenever `identifiable === false`, when the report came from an embedded WebView,
or when an unmatched Web submission is high-risk. Signals are never sent to a
browser or an app; security decisions belong on your backend, reading the stored
event by `requestId` or from webhooks.

Call `fingerly.collect()` to assemble the `SignalReport` locally without sending
anything over the network (requires `consent === 'granted'`).

The default browser run completes in a **single pass** under a `<= 350 ms`
wall-clock budget (`prerequisite` barrier stage followed by `collect` stage),
with zero follow-up sidecar requests.

## Privacy and embedded WebViews

[`docs/privacy.md`](docs/privacy.md) is the collection notice for integrators:
every signal each platform reads, what we add server-side, how long it is kept,
and what an integrator has to do about consent.

**Every SDK's `consent` defaults to `pending`**, which collects and sends nothing
until the integrator calls `setConsent('granted')` (or loads with `granted` once
they have consent, or know none is required for that visitor; see
`docs/privacy.md` §4). Every submission carries `"consent": "granted"`, and the
API refuses anything else with `422 consent_required`. Background in
[`server/docs/compliance/`](../server/docs/compliance/README.md).

**The browser SDK is not for apps.** Do not embed `@fingerly/web-js` or a
framework binding in an app's web view (iOS or macOS `WKWebView`, Android
`WebView`, Capacitor, Cordova, Ionic, React Native WebView, Flutter WebView,
Electron); use the native iOS or Android SDK, or the React Native, Flutter or
Lynx bridge. When `@fingerly/web-js` detects an embedded WebView, it skips all
device-fingerprinting collectors to preserve Apple DPLA §3.3.3(B) compliance,
runs only the non-identifying DPLA-safe runtime/integrity subset
(`EMBEDDED_SAFE_SOURCES`), and the server returns `visitorId: ""` under Option B
([`docs/privacy.md`](docs/privacy.md) §3.3).

## The SDK never asks the visitor for anything

No permission prompt, no picker, no dialog: not on any browser, not for any
signal. A fraud check that interrupts a checkout with a permission dialog has
destroyed the thing it was protecting, and a visitor who is asked has been told
they are being measured.

Reading a permission's *state* is fine and prompts nobody: `permissions.query()`
is specified never to prompt, and `enumerateDevices()` returns unlabelled
devices rather than asking. Requesting is what is banned: `getUserMedia`,
`Notification.requestPermission`, `getCurrentPosition`,
`DeviceMotionEvent.requestPermission`, `storage.persist`, `requestStorageAccess`,
file and device pickers, `credentials.get`, fullscreen and pointer-lock grabs.

`client/web/web-js/tests/no-permission-prompts.test.ts` enforces that list against
the source tree, so it cannot regress quietly.

The one API that prompts on some browsers and not others is canvas readback:
Tor Browser and Firefox with `privacy.resistFingerprinting` can raise a canvas
permission doorhanger. Stage 1 (`prerequisite`) runs `engine` and a bounded
`<= 3 ms` Gecko-only `performance.now()` clamping guard (`timing`) *before*
Stage 2 (`collect`) starts: whenever a clamped Gecko clock is detected, both
`shields` and `canvas` skip `<canvas>` readback altogether, reporting
`blocked / rfp-canvas-prompt-avoided` with zero prompts.
