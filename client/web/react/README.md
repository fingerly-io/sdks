<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly for React</b><br>A provider, three hooks, and one shared identification per page.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fingerly/react"><img src="https://img.shields.io/npm/v/@fingerly/react?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@fingerly/react"><img src="https://img.shields.io/npm/dm/@fingerly/react?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/fingerly-io/sdks/blob/main/client/web/react/LICENSE"><img src="https://img.shields.io/npm/l/@fingerly/react?style=flat-square" alt="Apache-2.0 licence"></a>
  <img src="https://img.shields.io/badge/react-19%2B-blue?style=flat-square" alt="React 19 or newer">
</p>

<p align="center"><img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/banner.webp" alt="Fingerly" width="100%"></p>

## What is this

`@fingerly/react` is the React binding for the Fingerly browser SDK. A
`<FingerlyProvider>` holds one client and one shared identification, and the
`useIdentify()` hook reads it, so a checkout, a login form and a risk banner can
all ask the same question and pay for one answer. [Fingerly](https://fingerly.io)
helps you protect signups, logins and payments from fraud and abuse. Using
Next.js? See [`@fingerly/next`](https://www.npmjs.com/package/@fingerly/next),
which wraps this package.

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
   npm install @fingerly/react
   # or: pnpm add @fingerly/react
   # or: yarn add @fingerly/react
   ```

3. **Add the provider, then identify.**

   ```tsx
   // main.tsx
   import { createRoot } from 'react-dom/client'
   import { FingerlyProvider } from '@fingerly/react'

   createRoot(document.getElementById('root')!).render(
     // consent="granted" only once you have consent (or know none is required here; see Consent below)
     <FingerlyProvider apiKey="fly_pk_production_…" consent="granted">
       <App />
     </FingerlyProvider>,
   )
   ```

   ```tsx
   import { useIdentify } from '@fingerly/react'

   function Checkout() {
     const { identify, isSuspicious, isLoading, error } = useIdentify()

     async function onSubmit() {
       await identify()

       if (isSuspicious) {
         // step up to MFA, hold for review, add friction
       }
     }

     return (
       <>
         <button onClick={onSubmit} disabled={isLoading}>
           {isLoading ? 'Checking…' : 'Continue'}
         </button>
         {error && <p>{error.message}</p>}
       </>
     )
   }
   ```

The key is a **public** SDK key from the dashboard, and it belongs in the page:
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

Mounting the provider collects nothing. It makes the client available and
nothing more; when to identify is the page's decision, not the provider's.

`identify()` collects and submits, and resolves with the server's answer in the
same round trip: the `requestId`, who the visitor is (`visitorId`), and the
`suspectScore` and `suspectLevel`, unless the key hides them. Nothing is decided
in the page: scoring lives on the server, under the weights you set.

## Contents

- [Identify on mount or with Suspense](#identify-on-mount-or-with-suspense)
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

## Identify on mount or with Suspense

### On mount

```tsx
const { suspectLevel, isReady } = useIdentify({ immediate: true })
```

`immediate` runs in an effect, which is what makes it **safe under SSR**:
effects do not run on the server, so a Next.js page using this renders
server-side and collects on the client with no guard of its own. It is also
safe under **StrictMode**: React's deliberate double mount costs one
identification, not two.

### Suspend until the answer arrives

```tsx
function Risk() {
  const { suspectLevel } = useIdentify({ suspend: true })
  return <Banner level={suspectLevel} />   // never renders an empty state
}

<Suspense fallback={<Spinner />}>
  <Risk />
</Suspense>
```

`suspend` reads the identification with `use()`, so the nearest `<Suspense>`
fallback shows while the collectors run and the nearest error boundary catches
a failure. It is for a component that has nothing meaningful to render until it
has the answer; everything else is better served by `isLoading`.

On the server it renders the unidentified state exactly as `immediate` does,
and suspends after hydration, since there is no browser to collect from during a
server render, and suspending there would wait for an answer that cannot
arrive.

## One identification per page

State lives in the provider, not in each `useIdentify()` call, and it reaches
components through `useSyncExternalStore`, so every component sees the same
identification at the same time, with no tearing. Three components asking
whether the visitor is suspicious produce **one** submission, one `requestId`,
and one line on your bill:

```tsx
// All three of Header.tsx, CheckoutForm.tsx, RiskBanner.tsx:
const { suspectLevel } = useIdentify({ immediate: true })
// → one network request, one shared answer
```

To deliberately identify again (a long-lived SPA reaching a second checkout):

```tsx
const { refresh } = useIdentify()
await refresh() // ignores the cached result and collects afresh
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
at render time:

```tsx
const { identify } = useIdentify({ tag: () => `checkout:${params.orderId}` })
```

## Consent

Consent defaults to `pending`, and nothing is collected or sent until it is
`granted`. If identifying a visitor needs their consent first, pass what your
consent tool says now: `useIdentify({ immediate: true })` and `suspend` wait,
and the client is not even built.

```tsx
<FingerlyProvider apiKey="fly_pk_production_…" consent={accepted ? 'granted' : 'pending'}>
```

Changing the prop to `granted` starts the identification that was waiting, once,
on the same store. A consent tool that reports through a callback can set it on
the store, or on the client, instead:

```tsx
const fingerly = useFingerly()
fingerly.setConsent('granted')             // from the consent tool's callback

const client = await fingerly.client()
client.setConsent('denied')                // the same, on the client itself
```

- `consent`: `'pending'` (the default), `'granted'` or `'denied'`. A provider
  prop, and an option to `createFingerlyStore()`.
- `setConsent(state)`: on the store from `useFingerly()`, and on the client.
  Synchronous, and setting the current value again does nothing.
- `consent` in `useIdentify()`: the current state, for rendering a banner.

`pending` and `denied` behave the same. Withdrawing consent while an
identification is running stops it before it submits, and it fails with a
`ConsentError`.

Pass `granted` only once you have consent, or know none is required here. See
section 4 of the
[privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md),
[privacy and consent](https://docs.fingerly.io/docs/privacy-and-consent) and
[consent tools](https://docs.fingerly.io/docs/consent-tools).

## First-party endpoints

Content blockers refuse requests to third-party hosts. Mount a first-party
proxy at the path the dashboard issued (see `@fingerly/node` or the proxy
templates) and pass that path as `endpoints`, a string or an array compared by
its contents:

```tsx
<FingerlyProvider apiKey="fly_pk_production_…" endpoints="/k7x2qm4a" consent="granted">
```

The proxy is mounted by a server SDK: see
[proxy integrations](https://docs.fingerly.io/docs/proxy-integrations) and the
[Node SDK](https://docs.fingerly.io/docs/sdks/node), or pick another language on
the [server SDK pages](https://docs.fingerly.io/docs/sdks).

## Options

`<FingerlyProvider>` props, and the options to `createFingerlyStore()`:

| Option | Type | Notes |
| --- | --- | --- |
| `apiKey` | `string` | Required. A public SDK key. |
| `endpoints` | `string \| string[]` | Ordered first-party ingestion paths or URLs, compared by contents. |
| `fallbackToDefaultEndpoint` | `boolean` | Try the Fingerly API only after the custom endpoints fail. |
| `consent` | `'pending' \| 'granted' \| 'denied'` | Defaults to `pending`. Read as the current answer. |
| `submit` | `boolean` | `false` collects without submitting (see below). |
| `apiVersion` | `string` | API route version. Defaults to `v1`. |
| `store` | `FingerlyStore` | A store built elsewhere; the other options are not allowed with it. |

`useIdentify()` options: `immediate`, `suspend` and `tag`. `identify()` takes
`{ tag, force }` and `refresh()` takes `{ tag }`.

### Collect without submitting

For a debug page that wants the raw report and nothing else:

```tsx
<FingerlyProvider apiKey="fly_pk_production_…" submit={false}>
```

Everything the server decides comes back empty: no `requestId`, no `visitorId`,
`suspectScore` is `null` rather than `0`, and `isSuspicious` is
`null` rather than `false`. That is the honest answer rather than a gap: nothing
was sent, so nobody scored it, and this SDK decides nothing on its own.

## What you get back

```tsx
const {
  requestId,         // string | null:        identifies this submission
  visitorId,         // string | null:        who the server decided this is
  visitorIsNew,      // boolean:              never seen before
  visitorConfidence, // number:               0 to 100
  identifiable,      // boolean:              false when the signals were too thin
  duplicate,         // boolean:              answered before; this is the first answer
  state,             // string | null:        the server's disposition
  suspectScore,      // number | null:        null when nothing scored it
  suspectLevel,      // string | null:        low, medium, high
  report,            // SignalReport | null:  every source, with status and timing
  error,             // Error | null
  consent,           // ConsentState        (granted, pending or denied)
  isLoading,    // boolean
  isReady,      // boolean:              finished, successfully or not
  isSuspicious, // boolean | null:       true for medium or high; null when the level is absent
  identify,     // () => Promise<IdentifyResult>
  refresh,      // () => Promise<IdentifyResult>
} = useIdentify()
```

`identify` and `refresh` are stable across renders, so they can go in a
dependency array without restarting anything.

`suspectScore` is `null`, not `0`, when nothing scored the submission. `0`
means "scored, nothing fired". `visitorId` and the rest of the server's fields
are empty under `submit: false`.

Weights and signal names never reach the browser: your backend reads them on the
server-side event read.

The detectors run on the server, over the report this package sends, so rules
improve without every integration redeploying. Everything here that says
anything about a visitor came from the server.

## Errors

`identify()` both stores the error and rethrows it, so either style works:

```tsx
try {
  await identify()
} catch (e) {
  // your own handling
}
```

```tsx
{error && <p>{error.message}</p>}
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

The provider builds its own store, which is what a browser app wants. A
server-rendered app that wants to be sure two visitors can never share one is
better served by building the store per request and handing it in:

```tsx
import { FingerlyProvider, createFingerlyStore } from '@fingerly/react'

const store = createFingerlyStore({ apiKey: 'fly_pk_production_…' })   // once per request
<FingerlyProvider store={store}><App /></FingerlyProvider>
```

The package is marked `'use client'`, so importing it from a React Server
Component is a build error rather than a runtime one: every export here
reaches a hook.

## More

### The visitor is never asked for anything

No permission prompt, no picker, no dialog, on any browser. Reading a
permission's *state* prompts nobody and is used freely; requesting is banned
outright and enforced by a test in `@fingerly/web-js`. The one browser API that
can prompt (Tor Browser answers it with a doorhanger) is skipped whenever the
SDK detects that browser would prompt.

You can drop this into a checkout without it ever interrupting the checkout.

<details>
<summary>Running the demo</summary>

`demo/` (in the
[repository](https://github.com/fingerly-io/sdks/tree/main/client/web/react)) is
this package's hooks driving the real SDK (no mocks) under `StrictMode`, with
`useIdentify({ suspend: true })` showing `suspectScore` and `suspectLevel`
beside the raw report, all sharing one identification.

```sh
pnpm --filter @fingerly/react demo   # http://localhost:4175
```

It is served rather than opened from disk because some collection needs a
secure context and `file://` is not one. It uses `submit: false`, so it sends
nothing and no server answers: the raw report fills in, and the score and level
read hidden.

</details>

## TypeScript

Types ship with the package. `FingerlyProviderProps`, `FingerlyReactOptions`,
`FingerlyState`, `FingerlyStore`, `UseIdentifyOptions` and `UseIdentifyReturn`
are exported, together with the types you receive (`IdentifyResult`,
`ConsentState`, `SignalReport`, `SignalOutcome`, `SignalStatus`,
`IntegrityReport`, `Lie`, `Confidence` and `FingerlyWebEvent`). The values
`ConsentError`, `TransportError`, `FingerlyServerError`, `createFingerlyStore`
and `FingerlyContext` are exported for `instanceof` checks and tests. The
package is side-effect free.

## Requirements

React **19 or newer** (it uses `use()` and renders a context directly). Tested
against 19.2. The browser SDK it wraps needs ES2020 with `fetch` and
`AbortController`: every current version of Chrome, Edge, Firefox and Safari.

## Documentation

The React guide is at
[docs.fingerly.io](https://docs.fingerly.io/docs/sdks/react). The browser SDK
underneath is [`@fingerly/web-js`](https://www.npmjs.com/package/@fingerly/web-js).

## Help

Open an issue on [fingerly-io/sdks](https://github.com/fingerly-io/sdks/issues),
or write to [support@fingerly.io](mailto:support@fingerly.io). Security issues:
[security@fingerly.io](mailto:security@fingerly.io).

## Licence

[Apache-2.0](https://github.com/fingerly-io/sdks/blob/main/client/web/react/LICENSE). Fingerly is a product of Badele LLC.
