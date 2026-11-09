# fingerly/sdks

Client and server SDKs for the Fingerly fraud detection/prevention platform. This repository
is the integration workspace: independently versioned SDK repositories are
mounted here as git submodules, alongside the pnpm workspace and Turborepo.

See [`server/docs/architecture.md`](../server/docs/architecture.md) for how this
repo relates to `server` and `panels`.

## Layout

- `client/web/types`: canonical TypeScript wire contracts, maintained in the
  standalone private `sdk-types` repository and consumed by TypeScript bridges.
- `client/web/core`: framework-agnostic client device/event core (TS), shared by browser SDKs.
  The budgeted scheduler, the signal vocabulary and the transport.
  Contains no DOM code and is compiled against the worker lib so that it cannot
  acquire any.
- `client/web/web-js`: vanilla browser SDK. The ~22 browser sources and the
  tamper layer that checks whether the browser is lying about them.
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
- `client/web/vue`: Vue 3 plugin and composables ([README](client/web/vue/README.md)).
  One shared identification per app, readonly reactive state, SSR-safe.
- `client/web/{react,svelte,angular,nuxt,next}`: implemented framework bindings,
  built on `web-js`/`vue`/`react`.
- `client/mobile/ios`: the native iOS SDK (Swift), a private source repository.
  Customers get the compiled framework as the Swift package
  [sdk-ios](https://github.com/fingerly-io/sdk-ios); React Native and Lynx download the
  same XCFramework during `pod install`, while Flutter supports both CocoaPods
  and Swift Package Manager.
- `client/mobile/android`: the native Android SDK (Kotlin), a private source repository.
  One dependency (coroutines), no JNI, and two install-time permissions that prompt
  nobody. Publishes an AAR as `io.fingerly:fingerly`, which is what the three bridges
  depend on. Both native SDKs are closed binaries under the Fingerly SDK License,
  distributed from `https://maven.fingerly.io` (the Android Maven repository, with the
  iOS artifact under `/ios/`).
- `client/mobile/react-native`, `client/mobile/flutter`, `client/mobile/lynx`: standalone bridges to the native SDKs, not
  second implementations, and open source under Apache-2.0. All three are thin on purpose: almost every signal worth
  having on a phone is unreachable from JavaScript or Dart, so a cross-platform
  SDK that collected only what it could reach would report a jailbroken,
  instrumented device as clean. React Native and Lynx are in the pnpm workspace;
  Flutter is a Dart/pub package and is not. Lynx supports Android and iOS hosts.
- `contract`: API contract synced from `server`'s OpenAPI spec; the sync point for
  the API shape across every SDK/panel consumer. Server SDKs vendor snapshots
  so they can build and test independently.

## Development

Clone and fetch the submodules the JavaScript workspace needs. The native SDK sources
are private, so a full recursive clone only works with access to them:

```
git clone https://github.com/fingerly-io/sdks.git
cd sdks
git submodule update --init -- client/web/types server/node client/mobile/react-native client/mobile/lynx
```

```
pnpm install
pnpm build
pnpm test
pnpm lint

pnpm --filter @fingerly/web-js demo   # http://localhost:4173
```

The iOS SDK is a separate toolchain and is not driven by Turborepo:

```
cd client/mobile/ios
xcodebuild test -scheme Fingerly -destination 'platform=iOS Simulator,name=iPhone 16e'
./Example/run.sh                    # builds, installs and launches on a booted simulator
```

Flutter is a separate Dart package:

```
cd client/mobile/flutter
flutter pub get
flutter analyze
flutter test
```

Lynx is a separate library and example app inside the pnpm workspace:

```
pnpm --dir client/mobile/lynx test
pnpm --dir client/mobile/lynx build
pnpm --dir client/mobile/lynx/example build
```

The demo page runs the browser SDK against whatever browser opens it and renders
the whole report: every source with its status and duration, and the tamper
measurements. It submits nothing unless an endpoint and SDK key are filled in. Serve it over `localhost` rather than opening the file directly:
several sources need a secure context, and `file://` is not one.

Install scripts are disabled for every dependency (`.npmrc`); the reason is
written out there.

Publish the browser packages with `pnpm publish`, never `npm publish`: only
pnpm rewrites the `workspace:` ranges between them, and a tarball that still
says `workspace:*` cannot be installed. After `pnpm build`, `pnpm check:packs`
packs every browser package the way it is published and fails on a leftover
`workspace:` range, a source map, shipped sources or tests, or a missing
LICENSE or README.

## Status

`core`, `web-js`, Node, the framework bindings, `client/mobile/ios`, `client/mobile/android`, and
the Flutter, React Native, and Lynx bridges are implemented.

## One envelope, three platforms

A browser, an iPhone and an Android phone submit the same `SignalReport`: a
schema version, a budget, the tiers that ran, a map of sources each carrying a
status and a duration, and the tamper layer's findings. What differs is which
sources are in the map.

That is what lets the server have one reader (`server/domain/risk/report.go`)
and one set of rules. The canonical TypeScript shape lives in
`client/web/types/src/index.ts`; `client/web/core` re-exports it, while
`client/mobile/ios/Sources/Fingerly/Core/Types.swift`
and `client/mobile/android/.../core/Types.kt` are literal ports of it, field for field,
because both ends were already written.

A native report carries raw measurements only, on the contract in
[`contract/native-report.md`](contract/native-report.md). No client holds a
weight, a threshold or a verdict: the server derives every signal from what it
received, in `server/domain/risk/native_*_rules.go`, under the customer's
weights, so a rule can change without an app update. A report claiming a verdict
(the old `device` source) is ignored.

A modified app can still forge raw input, and the server can only score what it
receives. Hardware attestation is what resists that: Android key attestation and
iOS App Attest are checked by the server against the platform vendor's roots, and
an event records `attested`, `not_attested` or `failed`.

## Using it

```ts
import { load } from '@fingerly/web-js'

// Consent defaults to 'pending', which collects and sends nothing. Pass
// 'granted' only once you have consent (or another lawful basis), or load
// with the default and call fingerly.setConsent('granted') from your consent tool.
const fingerly = await load({ apiKey: 'fly_pk_production_…', consent: 'granted' })
const result = await fingerly.identify({ tag: 'checkout' })
const { requestId, visitorId, suspectScore, suspectLevel } = result

// suspectScore and suspectLevel can be null: not scored, or hidden by the key.
if (suspectLevel === 'high') {
  // an interface hint only: your backend reads the event and decides
}

// The authoritative score above never changes. Expensive collectors continue
// as an immutable sidecar that applications may observe when useful.
const deferred = await result.deferred
```

Every SDK submits to `https://api.fingerly.io`. The optional
`endpoint`/`endpoints` setting always wins, which is how a customer uses the
Fingerly same-origin proxy on their own domain.

`identify()` collects and submits to `POST /api/v1/ingest`, resolving with the
server's answer: `visitorId` and, by default, `suspectScore` and `suspectLevel`
come back with the submission. The score and level are a convenience for trying
the product, and a per-key setting hides them, which looks the same as unscored.
Signals are never sent to a browser or an app. Security decisions belong on your
backend, reading the event by request ID, or from webhooks.
Pass `{ submit: false }` to collect without sending anything. Only the raw report
comes back then: the server's fields are empty, and `suspectScore` is `null`
rather than `0`, because nobody scored it.

The default browser run spends 300ms on the initial tier, then continues the
deferred tier under a separate 1200ms budget. Deferred data is archived against
the request but never changes identity, score, billing, or webhooks.

The SDK decides nothing. Every detector runs server-side over the stored report,
where the rules can improve without every customer redeploying an SDK. The answer
in the page can be edited by whoever controls it, so decide on your backend from
the stored event.

## Privacy

[`docs/privacy.md`](docs/privacy.md) is the collection notice for integrators:
every signal each platform reads, what we add server-side, how long it is kept,
and what an integrator has to do about consent.

The part to know: **every SDK's `consent` defaults to `pending`**, which
collects and sends nothing until the integrator calls `setConsent('granted')`
(or loads with `granted` once they have consent or another lawful basis). Every
submission carries `"consent": "granted"`, and the API refuses anything else
with `422 consent_required`. Background in
[`server/docs/compliance/`](../server/docs/compliance/README.md).

## The SDK never asks the visitor for anything

No permission prompt, no picker, no dialog: not on any browser, not for any
signal. A fraud check that interrupts a checkout with a permission dialog has
destroyed the thing it was protecting, and a visitor who is asked has been told
they are being measured.

Reading a permission's *state* is fine and prompts nobody: `permissions.query()`
is specified never to prompt, and `enumerateDevices()` returns unlabelled
devices rather than asking. Requesting is what is banned:
`getUserMedia`, `Notification.requestPermission`, `getCurrentPosition`,
`DeviceMotionEvent.requestPermission`, `storage.persist`,
`requestStorageAccess`, file and device pickers, `credentials.get`, fullscreen
and pointer-lock grabs.

`client/web/web-js/tests/no-permission-prompts.test.ts` enforces that list against
the source tree, so it cannot regress quietly.

The one API that prompts on some browsers and not others is canvas readback:
Tor Browser raises a doorhanger on `toDataURL()`. The canvas source checks
whether the fast tier measured a clamped clock (resistFingerprinting's
signature) and declines to touch the API at all if so, reporting
`blocked / rfp-canvas-prompt-avoided`. Nothing is lost: a canvas hash from an
RFP browser was never going to identify anyone, and the refusal is better
evidence than the hash would have been.
