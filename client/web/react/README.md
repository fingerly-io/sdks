# @fingerly/react

React bindings for the Fingerly SDK (`0.3.0`, single-pass `v: 3`). A provider,
two hooks (`useIdentify` and `useFingerly`), and one shared `1-RTT`
identification per page.

Requires React **19 or newer** (it uses `use()` and renders a context
directly). Tested against 19.2.

```sh
pnpm add @fingerly/react@^0.3.0
```

**Not for apps.** This binding runs `@fingerly/web-js`, which skips all
device-fingerprinting collectors inside embedded app WebViews (`WKWebView`,
Android `WebView`, Capacitor, Cordova, Ionic, React Native WebView, Flutter
WebView, Electron) to preserve Apple DPLA §3.3.3(B) compliance, running only the
non-identifying `EMBEDDED_SAFE_SOURCES` subset and returning `visitorId: ""`
under Option B. Use the native Fingerly iOS or Android SDK (or the React Native,
Flutter, or Lynx bridge) in an app; see [docs/privacy.md §3.3](../../../docs/privacy.md).

## Add the provider

```tsx
// main.tsx
import { createRoot } from 'react-dom/client'
import { FingerlyProvider } from '@fingerly/react'

createRoot(document.getElementById('root')!).render(
  // consent="granted" only once you have consent (or know none is required here; see docs/privacy.md §4)
  <FingerlyProvider
    apiKey="fly_pk_production_…"
    consent="granted"
    incognitoDetection="standard"
  >
    <App />
  </FingerlyProvider>,
)
```

The key is a **public** SDK key from the dashboard, and it belongs in the page:
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

Mounting the provider collects nothing. It makes the client available and
nothing more; when to identify is the page's decision, not the provider's.

Consent defaults to `pending`, and nothing is collected or sent until it is
`granted`. A page with a consent banner passes the banner's answer instead of
`"granted"`; see [Waiting for consent](#waiting-for-consent).

## Serve it from your own site

Content blockers refuse requests to third-party hosts. Mount a first-party
proxy at the path the dashboard issued (see `@fingerly/node` or the proxy
templates) and pass that path as `endpoints`, a string or an array compared by
its contents:

```tsx
<FingerlyProvider apiKey="fly_pk_production_…" endpoints="/k7x2qm4a" consent="granted">
```

## Identify (single-pass `v: 3`, `<= 350 ms` budget)

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

`identify()` runs a single-pass browser collection (`<= 350 ms` default budget,
including the Stage 1 Gecko `<= 3 ms` RFP timer guard and CSP-safe
`worker_realm` check) and submits once in **1 RTT** to `POST /api/v1/ingest`,
resolving with the server's answer: `requestId`, `visitorId`, `identifiable`,
and `suspectScore` / `suspectLevel` (unless hidden by the key). Nothing is
decided in the page: scoring lives on the server, under the weights you set.

### Decide on your backend

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

### On mount instead

```tsx
const { suspectLevel, isReady } = useIdentify({ immediate: true })
```

`immediate` runs in an effect, which is what makes it **safe under SSR**:
effects do not run on the server, so a Next.js page using this renders
server-side and collects on the client with no guard of its own. It is also
safe under **StrictMode**: React's deliberate double mount costs one
identification, not two.

### Or suspend until the answer arrives

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

### Incognito detection (`'standard' | 'extended'`)

Pass `incognitoDetection` on `<FingerlyProvider>`, `useIdentify()`, or
`identify()` / `refresh()`: `'standard'` (default) runs zero-write probes, while
`'extended'` opts into Chromium IndexedDB `storage_durability` timing within the
single-pass budget.

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

## Reading the answer & Option B

`suspectLevel` is the server's band for this submission, under the weights you
set. `isSuspicious` is `true` for `medium` or `high`, `false` for `low`, and
`null` when the level is absent: no server has answered yet, the submission went
unscored, or the SDK key hides the score from the page. Null is not a clean
result.

Under **Option B** (`v: 3`), `visitorId` is `null` before the first
identification completes, and afterwards holds `result.visitorId`, which is
`""` (with `visitorIsNew === false`) whenever `identifiable === false`, inside
an embedded WebView, or when an unmatched Web report is high-risk.

Signals are read on your backend, by `requestId`, never in the page: which check
tripped is what a fraudster wants to learn.

## A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It accepts a getter, and is read at submission time rather than
at render time:

```tsx
const { identify } = useIdentify({ tag: () => `checkout:${params.orderId}` })
```

## Local collection without submitting (`collect()`)

For a debug page that wants to inspect the raw `SignalReport` locally without
posting to `/api/v1/ingest`, call `collect()` on the underlying client:

```tsx
const fingerly = useFingerly()
const client = await fingerly.client()
const report = await client.collect()
```

`collect()` still requires `consent === 'granted'` and rejects with
`ConsentError` otherwise.

## Waiting for consent

Consent defaults to `pending`. Until it is `granted` nothing is collected and
nothing is sent: `useIdentify({ immediate: true })` and `suspend` wait, and the
client is not even built.

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

## Server rendering, and one store per request

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

## What you get back

```tsx
const {
  requestId,         // string | null:        identifies this submission
  visitorId,         // string | null:        null before completion; "" when identifiable === false (Option B)
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
the report stays in component state. Use `collect()` ([Local collection without submitting](#local-collection-without-submitting)) to inspect one.

`identify` and `refresh` are stable across renders, so they can go in a
dependency array without restarting anything. `suspectScore` is `null`, not `0`,
when nothing scored the submission or the key hides client scores (`0` means
"scored, nothing fired").

## The visitor is never asked for anything

No permission prompt, no picker, no dialog, on any browser. Stage 1 runs a
bounded `<= 3 ms` Gecko-only `performance.now()` clamping guard before Stage 2
starts, skipping `<canvas>` readback (`blocked / rfp-canvas-prompt-avoided`) on
Tor Browser and Firefox `resistFingerprinting` so no canvas doorhanger ever
appears.

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

`TransportError` carries a `status` (`401` for an invalid key or disallowed
origin, `402` when the organisation is not accepting traffic). `ConsentError`
means consent is not `granted` (`code: 'consent_required'`). Calling
`identify()` during SSR rejects with `FingerlyServerError`; use
`{ immediate: true }`, which waits for the client.

## Running the demo

```sh
pnpm --filter @fingerly/react demo   # http://localhost:4175
```

Serve it over `localhost` rather than opening from `file://`, as storage and
worker probes require a secure context.
