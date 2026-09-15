# badele/sdks

Client SDKs for the Badele fraud detection/prevention platform. This repository
is the integration workspace: independently versioned SDK repositories are
mounted here as git submodules, alongside the pnpm workspace and Turborepo.

See [`server/docs/architecture.md`](../server/docs/architecture.md) for how this
repo relates to `server` and `panels`.

## Layout

- `packages/types` — canonical TypeScript wire contracts, maintained in the
  standalone private `sdk-types` repository and consumed by TypeScript bridges.
- `packages/core` — framework-agnostic device/event core (TS), shared by web and Node SDKs.
  The budgeted scheduler, the signal vocabulary, the transport, and the detectors.
  Contains no DOM code and is compiled against the worker lib so that it cannot
  acquire any — `node` depends on it.
- `packages/web-js` — vanilla browser SDK. The ~22 browser sources and the
  tamper layer that checks whether the browser is lying about them.
- `packages/node` — server-side Node SDK for stored-event reads, webhook
  verification, and a framework-neutral same-origin proxy.
- `packages/vue` — Vue 3 plugin and composables ([README](packages/vue/README.md)).
  One shared identification per app, readonly reactive state, SSR-safe.
- `packages/{react,svelte,angular,nuxt,next}` — implemented framework bindings,
  built on `web-js`/`vue`/`react`.
- `mobile/ios` — the native iOS SDK (Swift). Implemented; see its
  [README](mobile/ios/README.md). Ships an SPM package and a podspec: React
  Native integrates through CocoaPods, while Flutter supports both CocoaPods
  and Swift Package Manager.
- `mobile/android` — the native Android SDK (Kotlin). Implemented; see its
  [README](mobile/android/README.md). One dependency (coroutines), no JNI, and
  two install-time permissions that prompt nobody. Publishes an AAR as
  `io.badele:badele`, which is what the three bridges depend on.
- `mobile/react-native`, `mobile/flutter`, `mobile/lynx` — standalone bridges to the native SDKs, not
  second implementations. All three are thin on purpose: almost every signal worth
  having on a phone is unreachable from JavaScript or Dart, so a cross-platform
  SDK that collected only what it could reach would report a jailbroken,
  instrumented device as clean. React Native and Lynx are in the pnpm workspace;
  Flutter is a Dart/pub package and is not. Lynx supports Android and iOS hosts.
- `contract` — API contract synced from `server`'s OpenAPI spec; the sync point for
  the API shape across every SDK/panel consumer

## Development

Clone recursively so the native SDKs, bridges, and shared contracts are present:

```
git clone --recurse-submodules git@github.com:badele-io/sdks.git
git submodule update --init --recursive
```

```
pnpm install
pnpm build
pnpm test
pnpm lint

pnpm --filter @badele/web-js demo   # http://localhost:4173
```

The iOS SDK is a separate toolchain and is not driven by Turborepo:

```
cd mobile/ios
xcodebuild test -scheme Badele -destination 'platform=iOS Simulator,name=iPhone 16e'
./Example/run.sh                    # builds, installs and launches on a booted simulator
```

Flutter is a separate Dart package:

```
cd mobile/flutter
flutter pub get
flutter analyze
flutter test
```

Lynx is a separate library and example app inside the pnpm workspace:

```
pnpm --dir mobile/lynx test
pnpm --dir mobile/lynx build
pnpm --dir mobile/lynx/example build
```

The demo page runs the browser SDK against whatever browser opens it and renders
the whole report — every source with its status and duration, the tamper
findings, and the verdicts. It submits nothing unless an endpoint and SDK key
are filled in. Serve it over `localhost` rather than opening the file directly:
several sources need a secure context, and `file://` is not one.

Install scripts are disabled for every dependency (`.npmrc`); the reason is
written out there.

## Status

`core`, `web-js`, Node, the framework bindings, `mobile/ios`, `mobile/android`, and
the Flutter, React Native, and Lynx bridges are implemented. See [`todo.md`](todo.md)
for what is done, what was measured, and what is left, and
[`docs/another library-teardown.md`](docs/another library-teardown.md) for the
another library teardown the design argues against.

## One envelope, three platforms

A browser, an iPhone and an Android phone submit the same `SignalReport`: a
schema version, a budget, the tiers that ran, a map of sources each carrying a
status and a duration, and the tamper layer's findings. What differs is which
sources are in the map.

That is what lets the server have one reader (`server/domain/risk/report.go`)
and one set of rules. The canonical TypeScript shape lives in
`packages/types/src/index.ts`; `packages/core` re-exports it, while
`mobile/ios/Sources/Badele/Core/Types.swift`
and `mobile/android/.../core/Types.kt` are literal ports of it, field for field,
because both ends were already written.

Native SDKs additionally emit a `device` source, which is the one thing the
server reads *by name*. Four flags are shared — `frida`, `mitm_attack`,
`developer_tools`, `device_farm` — and each platform adds its own: `jailbreak`
and `simulator` on iOS, `root_apps`, `emulator` and `cloned_app` on Android.
Both also carry `tampering`, `vpn_mobile` and the `timezone`/`locale` pair the
geo-mismatch rule needs.

Three of the Android keys are spelled differently from the verdict that produces
them — `root_apps` from `root`, `cloned_app` from `appCloner`,
`developer_tools` from `automation` — because `risk.androidFlags` is the
authority on the wire names and the SDK's are named for what they are. A typo in
either direction fails silently at every layer: the submission succeeds, the
event is stored, and a signal the customer is paying for never fires. Both ends
have a contract test pinning the same list for exactly that reason.

Those flags are assertions rather than observations — only the process can
answer them — so the SDK states them and the server records them.

## Using it

```ts
import { load } from '@badele/web-js'

const badele = await load({ apiKey: 'pk_live_…' })
const result = await badele.identify({ tag: 'checkout' })
const { requestId, visitorId, suspectScore, verdicts } = result

if (verdicts.automation.value && verdicts.automation.confidence === 'high') {
  // step up to a challenge
}

// The authoritative score above never changes. Expensive collectors continue
// as an immutable sidecar that applications may observe when useful.
const deferred = await result.deferred
```

Region-bound keys route themselves: `bd_pk_us_…` uses
`https://us.api.badele.io` and `bd_pk_eu_…` uses the isolated EU endpoint when
that region launches. Regionless legacy keys retain `https://api.badele.io`.
The optional `endpoint`/`endpoints` setting always wins, which is how a customer
uses the Badele same-origin proxy on their own domain; it does not change the
region bound into the credential or let traffic cross into another data plane.

`identify()` collects, scores locally, and submits to `POST /api/v1/identify`,
resolving with the server's verdict: `visitorId`, `suspectScore`,
`suspectLevel` and the triggers behind them come back with the submission, so
there is no second call to make. Pass `{ submit: false }` to collect and score
without sending anything — the server's fields are empty then, and
`suspectScore` is `null` rather than `0`, because nobody scored it.

The default browser run spends 300ms on the initial tier, then continues the
deferred tier under a separate 1200ms budget. Deferred data is archived against
the request but never changes identity, score, billing, or webhooks.

The verdicts returned here are advisory. The same detectors run again
server-side over the stored report, where the rules can improve without every
customer redeploying an SDK.

## Privacy

[`docs/privacy.md`](docs/privacy.md) is the collection notice for integrators:
every signal each platform reads, what we add server-side, how long it is kept,
and what an integrator has to do about consent.

The header on it is the part to know — **there is no consent parameter yet**, so
every SDK collects unconditionally the moment it is initialised. Until that
changes, gating initialisation is the integrator's job, and the docs say so.
Background in
[`server/docs/compliance/`](../server/docs/compliance/README.md).

## The SDK never asks the visitor for anything

No permission prompt, no picker, no dialog — not on any browser, not for any
signal. A fraud check that interrupts a checkout with a permission dialog has
destroyed the thing it was protecting, and a visitor who is asked has been told
they are being measured.

Reading a permission's *state* is fine and prompts nobody: `permissions.query()`
is specified never to prompt, and `enumerateDevices()` returns unlabelled
devices rather than asking. Requesting is what is banned —
`getUserMedia`, `Notification.requestPermission`, `getCurrentPosition`,
`DeviceMotionEvent.requestPermission`, `storage.persist`,
`requestStorageAccess`, file and device pickers, `credentials.get`, fullscreen
and pointer-lock grabs.

`packages/web-js/tests/no-permission-prompts.test.ts` enforces that list against
the source tree, so it cannot regress quietly.

The one API that prompts on some browsers and not others is canvas readback:
Tor Browser raises a doorhanger on `toDataURL()`. The canvas source checks
whether the fast tier measured a clamped clock — resistFingerprinting's
signature — and declines to touch the API at all if so, reporting
`blocked / rfp-canvas-prompt-avoided`. Nothing is lost: a canvas hash from an
RFP browser was never going to identify anyone, and the refusal is better
evidence than the hash would have been.
