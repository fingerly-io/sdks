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
- `mobile/ios`, `mobile/android` — native SDKs, currently standalone local repos
  (see their READMEs), destined to become git submodules once remotes exist
- `mobile/react-native` — JS/TS package in the pnpm workspace (bridges native
  modules)
- `mobile/flutter` — Dart/pub package, standalone local repo, not part of the pnpm
  workspace
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

The demo page runs the browser SDK against whatever browser opens it and renders
the whole report — every source with its status and duration, the tamper
findings, and the verdicts. It submits nothing unless an endpoint and SDK key
are filled in. Serve it over `localhost` rather than opening the file directly:
several sources need a secure context, and `file://` is not one.

Install scripts are disabled for every dependency (`.npmrc`); the reason is
written out there.

## Status

`core`, `web-js` and `vue` are implemented; the other framework bindings and the
Node SDK are still stubs. See [`todo.md`](todo.md) for what is done, what was
measured, and what is left, and [`docs/another library-teardown.md`](docs/another library-teardown.md)
for the another library teardown the design argues against.

## Using it

```ts
import { load } from '@badele/web-js'

const badele = await load({ apiKey: 'pk_live_…' })
const { requestId, verdicts, report } = await badele.identify({ tag: 'checkout' })

if (verdicts.automation.value && verdicts.automation.confidence === 'high') {
  // step up to a challenge
}
```

`identify()` collects, scores locally, and submits to `POST /api/v1/identify`,
returning as soon as the server has a receipt — IP enrichment and the velocity
windows are computed after the response, which is why this returns a
`requestId` rather than a finished event. Pass `{ submit: false }` to collect
and score without sending anything.

The verdicts returned here are advisory. The same detectors run again
server-side over the stored report, where the rules can improve without every
customer redeploying an SDK.

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
