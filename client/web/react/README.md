<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly for React</b><br>A provider, two hooks, and one shared identification per page.</p>

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
`useIdentify()` hook reads it (`useFingerly()` reaches the store and the client
underneath), so a checkout, a login form and a risk banner can all ask the same
question and pay for one answer. [Fingerly](https://fingerly.io) helps you
protect signups, logins and payments from fraud and abuse. Using Next.js? See
[`@fingerly/next`](https://www.npmjs.com/package/@fingerly/next), which wraps
this package.

> **Not for apps.** This binding runs the browser SDK, which collects no
> device-identifying signals inside an app's web view (Capacitor, Cordova,
> Ionic, React Native WebView, Flutter WebView, `WKWebView`, Android `WebView`,
> Electron), so the server answers there with an empty `visitorId`. This keeps
> apps within section 3.3.3(B) of Apple's developer licence. Use the Fingerly
> iOS or Android SDK, or the React Native, Flutter or Lynx bridge, in an app;
> see section 3.3 of the
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
   import { useState } from 'react'
   import { useIdentify } from '@fingerly/react'

   function Checkout({ orderId }: { orderId: string }) {
     const { identify, isLoading, error } = useIdentify({ tag: () => `checkout:${orderId}` })
     const [challenge, setChallenge] = useState(false)

     async function onSubmit() {
       // Use what identify() resolves with. A value read from this render
       // (isSuspicious, suspectLevel) is still the one from before the answer.
       const { requestId } = await identify()

       // The page only forwards the request ID. Your backend reads the event with
       // the secret key and decides; the page acts on that decision.
       const response = await fetch('/api/checkout', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ orderId, requestId }),
       })
       const { decision } = await response.json()
       setChallenge(decision === 'challenge')
     }

     return (
       <>
         <button onClick={onSubmit} disabled={isLoading}>
           {isLoading ? 'Checking…' : 'Continue'}
         </button>
         {challenge && <StepUp />}
         {error && <p>{error.message}</p>}
       </>
     )
   }
   ```

4. **Decide on your backend.** Read the event by `requestId` with the secret
   key; see [Decide on your backend](#decide-on-your-backend).

The key is a **public** SDK key from the dashboard, and it belongs in the page:
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

Mounting the provider collects nothing. It makes the client available and
nothing more; when to identify is the page's decision, not the provider's.

`identify()` collects in a single pass (within a 350 ms budget by default) and
submits once to `POST /api/v1/ingest`, resolving in the same round trip with
the server's answer: the `requestId`, who the visitor is (`visitorId`), whether
they could be identified (`identifiable`), and the `suspectScore` and
`suspectLevel`, unless the key hides them. Nothing is decided in the page:
scoring lives on the server, under the weights you set. Each report carries a
single-use freshness ticket, held in memory only; when none is held, the ticket
request runs in parallel with collection and never holds up or fails
`identify()`.

## Contents

- [Decide on your backend](#decide-on-your-backend)
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

## Decide on your backend

Whoever controls the page controls every branch in it, so access decisions
(allow, step up, hold, refuse) are made on your backend. The `requestId` the
page sends is untrusted form input until your backend has verified it. Read the
event with the secret key and run the checks described in
[server-side verification](https://docs.fingerly.io/docs/server-side-verification):

```ts
// server (Node.js), never in the page
import { BlockList } from 'node:net'
import { Fingerly, FingerlyAPIError } from '@fingerly/node'

const fingerly = new Fingerly({ secretKey: process.env.FINGERLY_SECRET_KEY })
const MAX_AGE_MS = 2 * 60 * 1000

// expectedTag comes from your server session (the order this visitor is
// paying for), never from the request body. clientIp is the address of this
// form post, as your framework resolves it behind your own proxies.
export async function decide(requestId: string, expectedTag: string, clientIp: string) {
  let event
  try {
    event = await fingerly.events.get(requestId)                       // 1. it exists
  } catch (error) {
    if (error instanceof FingerlyAPIError && error.isPending) return 'retry'
    if (error instanceof FingerlyAPIError && error.code === 'event_not_found') return 'refuse'
    throw error
  }
  if (event.tag !== expectedTag) return 'refuse'                           // 2. this action
  if (Date.now() - Date.parse(event.occurred_at) > MAX_AGE_MS) return 'refuse' // 3. recent
  if (!event.identifiable || event.suspect_score === null) return 'refuse' // 4. identifiable and scored
  if (event.suspect_level === 'high') return 'review'                      // 5. your policy
  // 6. another network than this post: step up (for example a second factor)
  if (!event.ip_network || !inNetwork(clientIp, event.ip_network)) return 'challenge'
  if (event.suspect_level === 'medium') return 'challenge'
  return 'allow'
}

// ip_network is the /24 (IPv4) or /40 (IPv6) the identification came from;
// the API never returns the address itself.
function inNetwork(ip: string, cidr: string): boolean {
  const [base = '', bits = '0'] = cidr.split('/')
  const type = base.includes(':') ? 'ipv6' : 'ipv4'
  const list = new BlockList()
  list.addSubnet(base, Number(bits), type)
  return list.check(ip, type)
}
```

`isSuspicious`, `suspectScore` and `suspectLevel` in the page are a UI hint
only (for example, to show a spinner a little longer). Never gate an action on
them. One event can back more than one decision inside the recency window; for
a flow that must be single use, record the `requestId` with the outcome and
refuse one you have already seen.

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
a failure. On the server it renders the unidentified state and suspends after
hydration.

## One identification per page

State lives in the provider, not in each `useIdentify()` call, and reaches
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
unscored, or the SDK key hides the score from the page. Null is not a clean
result.

`visitorId` is `null` before the first identification completes. Afterwards it
holds the server's answer, which is `""` (with `visitorIsNew` `false`) whenever
`identifiable` is `false`, inside an app's web view, or when an unmatched
browser report is high risk.

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
| `incognitoDetection` | `'standard' \| 'extended'` | Defaults to `standard` (see below). |
| `continuity` | `'none' \| 'session'` | Defaults to `none`, which keeps nothing in the browser; `session` keeps one signed value in `sessionStorage` for the life of the tab, so an identified private window is carried across its reports. |
| `apiVersion` | `string` | API route version. Defaults to `v1`. |
| `store` | `FingerlyStore` | A store built elsewhere; the other options are not allowed with it. |

`useIdentify()` options: `immediate`, `suspend`, `tag` and
`incognitoDetection`. `identify()` takes `{ tag, incognitoDetection, force }`
and `refresh()` takes `{ tag, incognitoDetection }`.

### Incognito detection

`incognitoDetection` is accepted on `<FingerlyProvider>`, `useIdentify()`, and
`identify()` / `refresh()`, the narrowest one winning. `'standard'` (the
default) never writes to the visitor's storage; `'extended'` opts into an
additional storage timing check on Chromium browsers, inside the same
collection budget.

### Collect without submitting

For a debug page that wants to inspect the raw `SignalReport` locally without
posting it to `/api/v1/ingest`, call `collect()` on the underlying client:

```tsx
const fingerly = useFingerly()
const client = await fingerly.client()
const report = await client.collect()
```

Nothing is sent, so nothing is scored and nothing in `useIdentify()` changes.
`collect()` still requires consent to be `granted` and rejects with a
`ConsentError` otherwise.

## What you get back

```tsx
const {
  requestId,         // string | null:        identifies this submission
  visitorId,         // string | null:        null before completion; "" when identifiable === false
  visitorIsNew,      // boolean:              true only when a new visitor was minted (false when visitorId === "")
  visitorConfidence, // number:               0 to 100
  identifiable,      // boolean:              false when the signals were too thin
  duplicate,         // boolean:              answered before; this is the cached answer
  state,             // string | null:        the server's disposition
  suspectScore,      // number | null:        null when unscored or hidden by the key
  suspectLevel,      // string | null:        low, medium, high
  identified,        // boolean:              an identification has succeeded
  error,             // Error | null
  consent,           // ConsentState        (granted, pending or denied)
  isLoading,         // boolean
  isReady,           // boolean:              finished, successfully or not
  isSuspicious,      // boolean | null:       UI hint only; true for medium or high, null when the level is absent
  identify,          // (opts?) => Promise<IdentifyAnswer>
  refresh,           // (opts?) => Promise<IdentifyAnswer>
} = useIdentify()
```

The binding never keeps the signal report: `identify()` resolves with the
server's answer (`IdentifyAnswer`, the result without `report`), and nothing of
the report stays in component state. Use `collect()`
([Collect without submitting](#collect-without-submitting)) to inspect one.

`identify` and `refresh` are stable across renders, so they can go in a
dependency array without restarting anything. `suspectScore` is `null`, not `0`,
when nothing scored the submission or the key hides client scores (`0` means
"scored, nothing fired").

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
same error until that time has passed; the error carries it as `retryAfterMs`.
After a transient failure without one (a `5xx`, a network error), components
that identify automatically wait 5 seconds, doubling per consecutive failure up
to a minute, so route changes during an outage send nothing; a call you make
yourself, such as on a click, still tries at once.

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
can prompt (Tor Browser, and Firefox with fingerprinting resistance on, answer
it with a doorhanger) is skipped whenever the SDK detects that browser would
prompt.

You can drop this into a checkout without it ever interrupting the checkout.

<details>
<summary>Running the demo</summary>

`demo/` (in the
[repository](https://github.com/fingerly-io/sdks/tree/main/client/web/react)) is
this package's hooks driving the real SDK (no mocks) under `StrictMode`, with
`useIdentify({ suspend: true })` showing `suspectScore` and `suspectLevel`, all
sharing one identification.

```sh
pnpm --filter @fingerly/react demo   # http://localhost:4175
```

Serve it over `localhost` rather than opening it from `file://`: some
collection needs a secure context, and `file://` is not one.

</details>

## TypeScript

Types ship with the package. `FingerlyProviderProps`, `FingerlyReactOptions`,
`FingerlyState`, `FingerlyStore`, `IdentifyAnswer`, `UseIdentifyOptions` and
`UseIdentifyReturn` are exported, together with the types you receive and pass
(`IdentifyResult`, `IdentifyOptions`, `CollectOptions`, `ConsentState`,
`IncognitoDetection`, `SuspectLevel`, `SignalReport`, `SignalOutcome`,
`SignalStatus`, `IntegrityReport`, `Lie` and `Confidence`). The values
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
