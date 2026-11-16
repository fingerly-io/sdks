# @fingerly/svelte

Svelte 5 bindings for the Fingerly SDK (`0.3.0`, single-pass `v: 3`). One state
per app, held in Svelte's context, read as plain reactive rune properties, with
one shared `1-RTT` identification per page.

Requires Svelte **5**. The state is built with runes, which is what lets a
component read `fingerly.suspectLevel` and re-render with no store, no
subscription and no `$` prefix at the call site.

```sh
pnpm add @fingerly/svelte@^0.3.0
```

**Not for apps.** This binding runs `@fingerly/web-js`, which skips all
device-fingerprinting collectors inside embedded app WebViews (`WKWebView`,
Android `WebView`, Capacitor, Cordova, Ionic, React Native WebView, Flutter
WebView, Electron) to preserve Apple DPLA §3.3.3(B) compliance, running only the
non-identifying `EMBEDDED_SAFE_SOURCES` subset and returning `visitorId: ""`
under Option B. Use the native Fingerly iOS or Android SDK (or the React Native,
Flutter, or Lynx bridge) in an app; see [docs/privacy.md §3.3](../../../docs/privacy.md).

## Set it up

```svelte
<!-- +layout.svelte, or your root component -->
<script lang="ts">
  import { setupFingerly } from '@fingerly/svelte'

  let { children } = $props()

  // consent: 'granted' only once you have consent (or know none is required here; see docs/privacy.md §4)
  setupFingerly({
    apiKey: 'fly_pk_production_…',
    endpoints: '/k7x2qm4a',
    consent: 'granted',
    incognitoDetection: 'standard',
  })
</script>

{@render children()}
```

`endpoints` is the path of your first-party proxy, the one the dashboard
issued. With `@fingerly/node` it is a SvelteKit endpoint at that path:

```js
// src/routes/k7x2qm4a/+server.js
import { Fingerly } from '@fingerly/node'

// Built on the first request rather than at import: the build imports this
// module, and the proxy key is a runtime secret.
let proxy
const addresses = new WeakMap()

export function POST(event) {
  proxy ??= Fingerly.createProxy({
    proxyKey: process.env.FINGERLY_PROXY_KEY,
    clientIp: (request) => addresses.get(request) ?? '',
  })
  // The connection's peer address, which adapter-node takes from its
  // ADDRESS_HEADER setting when the app runs behind a trusted proxy.
  addresses.set(event.request, event.getClientAddress())
  return proxy(event.request)
}
```

The key is a **public** SDK key from the dashboard, and it belongs in the page:
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

Setting up collects nothing. It makes the client reachable and no more; when to
identify is the page's decision. Like every Svelte context call it has to run
during component initialisation: a `<script>` block, not an event handler and
not an `$effect`.

Consent defaults to `pending`, and nothing is collected or sent until it is
`granted`. A page with a consent banner leaves it `pending` and calls
`setConsent('granted')` once the banner is accepted; see
[Waiting for consent](#waiting-for-consent).

## Identify (single-pass `v: 3`, `<= 350 ms` budget)

```svelte
<script lang="ts">
  import { useIdentify } from '@fingerly/svelte'

  const fingerly = useIdentify()

  async function submit() {
    await fingerly.identify()

    if (fingerly.isSuspicious) {
      // step up to MFA, hold for review, add friction
    }
  }
</script>

<button onclick={submit} disabled={fingerly.isLoading}>
  {fingerly.isLoading ? 'Checking…' : 'Continue'}
</button>

{#if fingerly.error}<p>{fingerly.error.message}</p>{/if}
```

`identify()` runs a single-pass browser collection (`<= 350 ms` default budget,
including the Stage 1 Gecko `<= 3 ms` RFP timer guard and CSP-safe
`worker_realm` check) and submits once in **1 RTT** to `POST /api/v1/ingest`,
resolving with the server's answer: `requestId`, `visitorId`, `identifiable`,
and `suspectScore` / `suspectLevel` (unless hidden by the key). Nothing is
decided in the page: scoring lives on the server, under the weights you set.

### On mount instead

```svelte
<script lang="ts">
  const fingerly = useIdentify({ immediate: true })
</script>
```

`immediate` runs in an `$effect`, which is what makes it **safe under SSR**:
effects do not run during a server render, so a SvelteKit page using this
renders on the server and collects on the client with no guard of its own.

Pass it in as many components as want it. The state is shared, so the second
and third callers get the first one's answer rather than starting their own
submission.

### Incognito detection (`'standard' | 'extended'`)

Pass `incognitoDetection` on `setupFingerly()`, `useIdentify()` (accepts a value
or getter), or `identify()` / `refresh()`: `'standard'` (default) runs
zero-write probes, while `'extended'` opts into Chromium IndexedDB
`storage_durability` timing within the single-pass budget.

## One identification per page

The state lives in context, not in each `useIdentify()` call. Three components
asking whether the visitor is suspicious produce **one** submission, one
`requestId`, and one line on your bill:

```svelte
<!-- All three of Header.svelte, CheckoutForm.svelte, RiskBanner.svelte: -->
const fingerly = useIdentify({ immediate: true })
<!-- → one network request, one shared answer -->
```

Context rather than a module-level singleton, and the reason is the server: a
module-level state on a SvelteKit server is shared by every request the process
renders. Context is per component tree, and a component tree is per request.

To deliberately identify again (a long-lived app reaching a second checkout):

```ts
await fingerly.refresh() // ignores the cached result and collects afresh
```

## Reading the answer & Option B

`suspectLevel` is the server's band for this submission, under the weights you
set. `isSuspicious` is `true` for `medium` or `high`, `false` for `low`, and
`null` when the level is absent: no server has answered yet, the submission went
unscored, or the SDK key hides the score from the page. Null is not a clean
result.

Under **Option B** (`v: 3`), `fingerly.visitorId` is `null` before the first
identification completes, and afterwards holds `result.visitorId` — which is
`""` (with `fingerly.visitorIsNew === false`) whenever
`fingerly.identifiable === false`, inside an embedded WebView, or when an
unmatched Web report is high-risk.

Signals are read on your backend, by `requestId`, never in the page: which check
tripped is what a fraudster wants to learn.

## A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It accepts a getter, and is read at submission time rather than
at initialisation:

```ts
const fingerly = useIdentify({ tag: () => `checkout:${page.params.orderId}` })
```

## Local collection without submitting (`collect()`)

For a debug page that wants to inspect the raw `SignalReport` locally without
posting to `/api/v1/ingest`, call `collect()` on the underlying client:

```ts
const client = await fingerly.client()
const report = await client.collect()
```

`collect()` still requires `consent === 'granted'` and rejects with
`ConsentError` otherwise.

## Waiting for consent

If identifying a visitor needs their consent first, set up with `consent:
'pending'`, the default. Until it is `granted` nothing is collected and nothing
is sent: `useIdentify({ immediate: true })` waits, and the client is not even
built.

```ts
const fingerly = setupFingerly({ apiKey: 'fly_pk_production_…', consent: 'pending' })
```

Then set it from wherever your consent tool reports the answer:

```ts
fingerly.setConsent('granted')             // from the consent tool's callback

const client = await fingerly.client()
client.setConsent('denied')                // the same, on the client itself
```

- `consent`: `'pending'` (the default), `'granted'` or `'denied'`, an option to
  `setupFingerly()` and `createFingerly()`.
- `setConsent(state)`: on the object `setupFingerly()`, `useFingerly()` and
  `useIdentify()` return, and on the client. Synchronous, and setting the
  current value again does nothing.
- `fingerly.consent`: the current state, reactive, for rendering a banner.

Setting `granted` starts the identification that was waiting, once. `pending`
and `denied` behave the same. Withdrawing consent while an identification is
running stops it before it submits, and it fails with a `ConsentError`.

## What you get back

```ts
const fingerly = useIdentify()

fingerly.requestId         // string | null:        identifies this submission
fingerly.visitorId         // string | null:        null before completion; "" when identifiable === false (Option B)
fingerly.visitorIsNew      // boolean:              true only when a new visitor was minted
fingerly.visitorConfidence // number:               0 to 100
fingerly.identifiable      // boolean:              false when the signals were too thin
fingerly.duplicate         // boolean:              answered before; this is the cached answer
fingerly.state             // string | null:        the server's disposition
fingerly.suspectScore      // number | null:        null when unscored or hidden by the key
fingerly.suspectLevel      // string | null:        low, medium, high
fingerly.report            // SignalReport | null:  every source, with status and timing
fingerly.error             // Error | null
fingerly.consent           // ConsentState        (granted, pending or denied)
fingerly.isLoading         // boolean
fingerly.isReady           // boolean:              finished, successfully or not
fingerly.isSuspicious      // boolean | null:       true for medium or high; null when absent
fingerly.identify()        // Promise<IdentifyResult>
fingerly.refresh()         // Promise<IdentifyResult>
fingerly.setConsent('granted')
```

Every field is a getter over a rune, so reading one in a template subscribes to
it and reading one in an event handler gets the current value. None of them is
settable.

## The visitor is never asked for anything

No permission prompt, no picker, no dialog, on any browser. Stage 1 runs a
bounded `<= 3 ms` Gecko-only `performance.now()` clamping guard before Stage 2
starts, skipping `<canvas>` readback (`blocked / rfp-canvas-prompt-avoided`) on
Tor Browser and Firefox `resistFingerprinting` so no canvas doorhanger ever
appears.

## Errors

`identify()` both stores the error and rethrows it, so either style works:

```ts
try {
  await fingerly.identify()
} catch (error) {
  // your own handling
}
```

```svelte
{#if fingerly.error}<p>{fingerly.error.message}</p>{/if}
```

A failed identification is not repeated behind your back. When the server
answers `429` with `Retry-After`, every call, `refresh()` included, gets the
same error until that time has passed; the error carries it as `retryAfterMs`.
After a transient failure without one (a `5xx`, a network error), components
that identify automatically wait 5 seconds, doubling per consecutive failure up
to a minute, so route changes during an outage send nothing; a call you make
yourself, such as on a click, still tries at once.

`TransportError` carries a `status` (`401` for an invalid key or disallowed
origin, `402` when the organisation is not accepting traffic). `ConsentError`
means consent is not `granted` (`code: 'consent_required'`). Calling
`identify()` during SSR rejects with `FingerlyServerError`; use
`{ immediate: true }`, which waits for the client.

## Running the playground

```sh
pnpm --filter @fingerly/svelte playground   # http://localhost:4176
```

## A note on the build

The package is emitted by `tsc`, not bundled, and that is a requirement rather
than a preference. The runes in `*.svelte.js` are compiled by the *app's*
Svelte plugin, which decides what to compile by the file name. Bundling them
into an `index.js` would hand the app a file full of `$state(…)` that nothing
compiles, and `$state is not defined` at runtime.
