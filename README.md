# badele/sdks

Client SDKs for the Badele fraud detection/prevention platform. pnpm workspace +
Turborepo.

See [`server/docs/architecture.md`](../server/docs/architecture.md) for how this
repo relates to `server` and `panels`.

## Layout

- `packages/core` — framework-agnostic device/event core (TS), shared by every SDK.
  The budgeted scheduler, the signal vocabulary, the transport, and the detectors.
  Contains no DOM code and is compiled against the worker lib so that it cannot
  acquire any — `node` and `react-native` both depend on it.
- `packages/web-js` — vanilla browser SDK. The ~22 browser sources and the
  tamper layer that checks whether the browser is lying about them.
- `packages/node` — server-side Node SDK
- `packages/vue` — Vue 3 plugin and composables ([README](packages/vue/README.md)).
  One shared identification per app, readonly reactive state, SSR-safe.
- `packages/{react,svelte,angular,nuxt,next}` — framework bindings, built on
  `web-js`/`vue`/`react`. Still stubs; `vue` is the template to follow.
- `mobile/ios` — the native iOS SDK (Swift). Implemented; see its
  [README](mobile/ios/README.md). Ships an SPM package and a podspec, because
  React Native and Flutter integrate native code through CocoaPods and neither
  can consume a Swift package from a plugin.
- `mobile/android` — the native Android SDK (Kotlin). Implemented; see its
  [README](mobile/android/README.md). One dependency (coroutines), no JNI, and
  two install-time permissions that prompt nobody. Publishes an AAR as
  `io.badele:badele`, which is what the two bridges depend on.
- `mobile/react-native`, `mobile/flutter` — bridges to the native SDKs, not
  second implementations. Both are thin on purpose: almost every signal worth
  having on a phone is unreachable from JavaScript or Dart, so a cross-platform
  SDK that collected only what it could reach would report a jailbroken,
  instrumented device as clean. `react-native` is in the pnpm workspace;
  `flutter` is a Dart/pub package and is not.
- Both are standalone local repos destined to become git submodules once the
  remotes in `.gitmodules` exist.
- `contract` — API contract synced from `server`'s OpenAPI spec; the sync point for
  the API shape across every SDK/panel consumer

## Development

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

The demo page runs the browser SDK against whatever browser opens it and renders
the whole report — every source with its status and duration, the tamper
findings, and the verdicts. It submits nothing unless an endpoint and SDK key
are filled in. Serve it over `localhost` rather than opening the file directly:
several sources need a secure context, and `file://` is not one.

Install scripts are disabled for every dependency (`.npmrc`); the reason is
written out there.

## Status

`core`, `web-js`, the framework bindings, `mobile/ios` and `mobile/android` are
implemented. The Node SDK is not. See [`todo.md`](todo.md) for what is done,
what was measured, and what is left, and
[`docs/another library-teardown.md`](docs/another library-teardown.md) for the
another library teardown the design argues against.

## One envelope, three platforms

A browser, an iPhone and an Android phone submit the same `SignalReport`: a
schema version, a budget, the tiers that ran, a map of sources each carrying a
status and a duration, and the tamper layer's findings. What differs is which
sources are in the map.

That is what lets the server have one reader (`server/domain/risk/report.go`)
and one set of rules, and it is why `packages/core`'s `types.ts` is the only
place the shape is written down — `mobile/ios/Sources/Badele/Core/Types.swift`
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
const { requestId, visitorId, suspectScore, verdicts } = await badele.identify({ tag: 'checkout' })

if (verdicts.automation.value && verdicts.automation.confidence === 'high') {
  // step up to a challenge
}
```

`identify()` collects, scores locally, and submits to `POST /api/v1/identify`,
resolving with the server's verdict: `visitorId`, `suspectScore`,
`suspectLevel` and the triggers behind them come back with the submission, so
there is no second call to make. Pass `{ submit: false }` to collect and score
without sending anything — the server's fields are empty then, and
`suspectScore` is `null` rather than `0`, because nobody scored it.

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
