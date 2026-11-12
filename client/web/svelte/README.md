<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly for Svelte</b><br>One state per app, held in Svelte's context, read as plain reactive properties.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fingerly/svelte"><img src="https://img.shields.io/npm/v/@fingerly/svelte?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@fingerly/svelte"><img src="https://img.shields.io/npm/dm/@fingerly/svelte?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/fingerly-io/sdks/blob/main/client/web/svelte/LICENSE"><img src="https://img.shields.io/npm/l/@fingerly/svelte?style=flat-square" alt="Apache-2.0 licence"></a>
  <img src="https://img.shields.io/badge/svelte-5%2B-blue?style=flat-square" alt="Svelte 5 or newer">
</p>

<p align="center"><img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/banner.webp" alt="Fingerly" width="100%"></p>

## What is this

`@fingerly/svelte` is the Svelte 5 binding for the Fingerly browser SDK. The
state is built with runes, which is what lets a component read
`fingerly.suspectLevel` and re-render with no store, no subscription and no `$`
prefix at the call site. [Fingerly](https://fingerly.io) helps you protect
signups, logins and payments from fraud and abuse.

> **Not for apps.** This binding runs the browser SDK, which collects nothing
> inside an app's web view (Capacitor, Cordova, Ionic, React Native WebView,
> `WKWebView`, Android `WebView`, Electron). Use the Fingerly iOS or Android SDK
> in an app; see section 3.3 of the
> [privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md).

## Getting started

1. **Get a key.** Create a public SDK key in the dashboard
   ([how keys work](https://docs.fingerly.io/docs/api-keys)).
2. **Install.**

   ```sh
   npm install @fingerly/svelte
   # or: pnpm add @fingerly/svelte
   # or: yarn add @fingerly/svelte
   ```

3. **Set it up once, then identify.**

   ```svelte
   <!-- +layout.svelte, or your root component -->
   <script lang="ts">
     import { setupFingerly } from '@fingerly/svelte'

     let { children } = $props()

     // consent: 'granted' only once you have consent (or know none is required here; see Consent below)
     setupFingerly({ apiKey: 'fly_pk_production_…', endpoints: '/k7x2qm4a', consent: 'granted' })
   </script>

   {@render children()}
   ```

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

`endpoints` is the path of your first-party proxy, the one the dashboard
issued (see [First-party endpoints](#first-party-endpoints)); drop it to post to
the Fingerly API directly.

The key is a **public** SDK key from the dashboard, and it belongs in the page:
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

Setting up collects nothing. It makes the client reachable and no more; when to
identify is the page's decision. Like every Svelte context call it has to run
during component initialisation: a `<script>` block, not an event handler and
not an `$effect`.

`identify()` collects and submits, and resolves with the server's answer in the
same round trip: the `requestId`, who the visitor is (`visitorId`), and the
`suspectScore` and `suspectLevel`, unless the key hides them. Nothing is decided
in the page: scoring lives on the server, under the weights you set.

## Contents

- [Identify on mount](#identify-on-mount)
- [One identification per page](#one-identification-per-page)
- [Reading the answer](#reading-the-answer)
- [Consent](#consent)
- [First-party endpoints](#first-party-endpoints)
- [Options](#options)
- [What you get back](#what-you-get-back)
- [Errors](#errors)
- [Server rendering](#server-rendering)
- [More](#more)
- [TypeScript](#typescript)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Help](#help)
- [Licence](#licence)

## Identify on mount

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

```svelte
await fingerly.refresh() // ignores the cached result and collects afresh
```

## Reading the answer

`suspectLevel` is the server's band for this submission, under the weights you
set. `isSuspicious` is `true` for `medium` or `high`, `false` for `low`, and
`null` when the level is absent: no server has answered yet, the submission went
unscored, or the SDK key hides the score from the page, which cannot tell those
apart. Null is not a clean result.

Signals are read on your backend, by `requestId`, never in the page: which check
tripped is what a fraudster wants to learn. See
[server-side verification](https://docs.fingerly.io/docs/server-side-verification)
and the [server SDKs](https://docs.fingerly.io/docs/sdks).

### A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It accepts a getter, and is read at submission time rather than
at initialisation:

```ts
const fingerly = useIdentify({ tag: () => `checkout:${page.params.orderId}` })
```

## Consent

Consent defaults to `pending`, and nothing is collected or sent until it is
`granted`. A page with a consent banner leaves it `pending` and calls
`setConsent('granted')` once the banner is accepted. If identifying a visitor
needs their consent first, set up with `consent: 'pending'`, the default:
`useIdentify({ immediate: true })` waits, and the client is not even built.

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

Pass `granted` only once you have consent, or know none is required here. See
section 4 of the
[privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md),
[privacy and consent](https://docs.fingerly.io/docs/privacy-and-consent) and
[consent tools](https://docs.fingerly.io/docs/consent-tools).

## First-party endpoints

Content blockers refuse requests to third-party hosts. `endpoints` is the path
of your first-party proxy, the one the dashboard issued. With `@fingerly/node`
it is a SvelteKit endpoint at that path:

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

See [proxy integrations](https://docs.fingerly.io/docs/proxy-integrations) and
the [Node SDK](https://docs.fingerly.io/docs/sdks/node), or pick another
language on the [server SDK pages](https://docs.fingerly.io/docs/sdks).

## Options

`setupFingerly(options)` and `createFingerly(options)`:

| Option | Type | Notes |
| --- | --- | --- |
| `apiKey` | `string` | Required. A public SDK key. |
| `endpoints` | `string \| string[]` | Ordered first-party ingestion paths or URLs. |
| `fallbackToDefaultEndpoint` | `boolean` | Try the Fingerly API only after the custom endpoints fail. |
| `consent` | `'pending' \| 'granted' \| 'denied'` | Defaults to `pending`. |
| `submit` | `boolean` | `false` collects without submitting (see below). |
| `apiVersion` | `string` | API route version. Defaults to `v1`. |

`useIdentify()` options: `immediate` and `tag` (a string or a getter).
`identify()` takes `{ tag, force }` and `refresh()` takes `{ tag }`.

### Collect without submitting

For a debug page that wants the raw report and nothing else:

```ts
setupFingerly({ apiKey: 'fly_pk_production_…', submit: false })
```

Everything the server decides comes back empty: no `requestId`, no `visitorId`,
`suspectScore` is `null` rather than `0`, and `isSuspicious` is
`null` rather than `false`. That is the honest answer rather than a gap: nothing
was sent, so nobody scored it, and this SDK decides nothing on its own.

## What you get back

```ts
const fingerly = useIdentify()

fingerly.requestId         // string | null:        identifies this submission
fingerly.visitorId         // string | null:        who the server decided this is
fingerly.visitorIsNew      // boolean:              never seen before
fingerly.visitorConfidence // number:               0 to 100
fingerly.identifiable      // boolean:              false when the signals were too thin
fingerly.duplicate         // boolean:              answered before; this is the first answer
fingerly.state             // string | null:        the server's disposition
fingerly.suspectScore      // number | null:        null when nothing scored it
fingerly.suspectLevel      // string | null:        low, medium, high
fingerly.report            // SignalReport | null:  every source, with status and timing
fingerly.error             // Error | null
fingerly.consent           // ConsentState        (granted, pending or denied)
fingerly.isLoading    // boolean
fingerly.isReady      // boolean:              finished, successfully or not
fingerly.isSuspicious // boolean | null:       true for medium or high; null when the level is absent
fingerly.identify()   // Promise<IdentifyResult>
fingerly.refresh()    // Promise<IdentifyResult>
fingerly.setConsent('granted')
```

Every field is a getter over a rune, so reading one in a template subscribes to
it and reading one in an event handler gets the current value. None of them is
settable: the state is shared, so a component that could assign to it would be
changing what every other component sees.

Weights and signal names never reach the browser: your backend reads them on the
server-side event read.

The detectors run on the server, over the report this package sends, so rules
improve without every integration redeploying. Everything here that says
anything about a visitor came from the server.

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
same error until that time has passed; the error carries it as
`retryAfterMs`. After a transient failure without one (a `5xx`, a network
error), components that identify automatically wait 5 seconds, doubling per
consecutive failure up to a minute, so route changes during an outage send
nothing; a call you make yourself, such as on a click, still tries at once.
Any other failure, such as a wrong key, is tried again on the next call.

`TransportError` carries a `status`. The two worth branching on are `401` (the
key is wrong, or was used from an origin it does not list) and `402` (the
organisation is not accepting traffic). Both are your configuration rather than
the visitor's.

`ConsentError` means consent is not `granted`. It carries `code:
'consent_required'` and the `state`, and lands in `error` like any other
failure. `{ immediate: true }` waits for consent rather than producing one, so
it only sees this error when consent is withdrawn while it runs.

Calling `identify()` during SSR rejects with `FingerlyServerError` and a message
saying what to do instead. Use `{ immediate: true }`, which already waits for
the client. The error reference is at
[docs.fingerly.io](https://docs.fingerly.io/reference/errors).

## Server rendering

The state is created in context, one per component tree, and a component tree is
per request, so two visitors never share one on a SvelteKit server.
`{ immediate: true }` runs in an `$effect`, which does not run during a server
render, so the page renders on the server and collects in the browser.

## More

### The visitor is never asked for anything

No permission prompt, no picker, no dialog, on any browser. Reading a
permission's *state* prompts nobody and is used freely; requesting is banned
outright and enforced by a test in `@fingerly/web-js`. The one browser API that
can prompt (Tor Browser answers it with a doorhanger) is skipped whenever the
SDK detects that browser would prompt.

You can drop this into a checkout without it ever interrupting the checkout.

<details>
<summary>Running the playground</summary>

`playground/` (in the
[repository](https://github.com/fingerly-io/sdks/tree/main/client/web/svelte))
is this package's own state and hooks driving the real SDK (no mocks), showing
`suspectScore` and `suspectLevel` beside the raw report, all sharing one
identification. It uses `submit: false`, so no server answers: the raw report
fills in, and the score and level read hidden.

```sh
pnpm --filter @fingerly/svelte playground   # http://localhost:4176
```

</details>

<details>
<summary>A note on the build</summary>

The package is emitted by `tsc`, not bundled, and that is a requirement rather
than a preference. The runes in `*.svelte.js` are compiled by the *app's*
Svelte plugin, which decides what to compile by the file name. Bundling them
into an `index.js` would hand the app a file full of `$state(…)` that nothing
compiles, and `$state is not defined` at runtime.

</details>

## TypeScript

Types ship with the package. `Fingerly`, `FingerlyOptions` and
`UseIdentifyOptions` are exported, together with the types you receive
(`IdentifyResult`, `ConsentState`, `SignalReport`, `SignalOutcome`,
`SignalStatus`, `IntegrityReport`, `Lie`, `Confidence` and `FingerlyWebEvent`).
The values `ConsentError`, `TransportError`, `FingerlyServerError` and
`FINGERLY_KEY` (the context key, for an advanced `getContext()`) are exported
too. The package is side-effect free.

## Requirements

Svelte **5**. The browser SDK it wraps needs ES2020 with `fetch` and
`AbortController`: every current version of Chrome, Edge, Firefox and Safari.

## Documentation

The Svelte guide is at
[docs.fingerly.io](https://docs.fingerly.io/docs/sdks/svelte). The browser SDK
underneath is [`@fingerly/web-js`](https://www.npmjs.com/package/@fingerly/web-js).

## Help

Open an issue on [fingerly-io/sdks](https://github.com/fingerly-io/sdks/issues),
or write to [support@fingerly.io](mailto:support@fingerly.io). Security issues:
[security@fingerly.io](mailto:security@fingerly.io).

## Licence

[Apache-2.0](https://github.com/fingerly-io/sdks/blob/main/client/web/svelte/LICENSE). Fingerly is a product of Badele LLC.
