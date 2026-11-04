# @fingerly/react

React bindings for the Fingerly SDK. A provider, three hooks, and one shared
identification per page.

Requires React **19 or newer** (it uses `use()` and renders a context
directly). Tested against 19.2.

```
pnpm add @fingerly/react
```

## Add the provider

```tsx
// main.tsx
import { createRoot } from 'react-dom/client'
import { FingerlyProvider } from '@fingerly/react'

createRoot(document.getElementById('root')!).render(
  // consent="granted" only once you have consent (or another lawful basis)
  <FingerlyProvider apiKey="fly_pk_production_…" consent="granted">
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

## Identify

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

`identify()` collects, scores locally, and submits, and resolves with the
server's verdict in the same round trip: the `requestId`, who the visitor is
(`visitorId`), and the `suspectScore`, `suspectLevel` and triggers behind it.

### On mount instead

```tsx
const { verdicts, isReady } = useIdentify({ immediate: true })
```

`immediate` runs in an effect, which is what makes it **safe under SSR**:
effects do not run on the server, so a Next.js page using this renders
server-side and collects on the client with no guard of its own. It is also
safe under **StrictMode**: React's deliberate double mount costs one
identification, not two.

### Or suspend until the answer arrives

```tsx
function Risk() {
  const { verdicts } = useIdentify({ suspend: true })
  return <Banner verdicts={verdicts} />   // never renders an empty state
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
const { verdicts } = useIdentify({ immediate: true })
// → one network request, one shared answer
```

To deliberately identify again (a long-lived SPA reaching a second checkout):

```tsx
const { refresh } = useIdentify()
await refresh() // ignores the cached result and collects afresh
```

## A single verdict

`useVerdict()` is for the common case where a component cares about exactly one
question:

```tsx
function AutomationNotice() {
  const { matched, confidence, reasons } = useVerdict('automation')
  if (!matched) return null

  return (
    <aside>
      Automated access suspected ({confidence})
      <ul>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
    </aside>
  )
}
```

Names: `incognito` · `shields` · `tor` · `emulator` · `automation` · `farm`. `shields` says anti-fingerprinting protection is rewriting some values, which is not a finding about the visitor on its own.

`matched` requires **medium confidence or better** by default. A
`low`-confidence verdict is a single weak tell (one removable flag, or one
countermeasure a privacy-conscious real user might equally be running), and
acting on it would generate false positives. Raise or lower it explicitly:

```tsx
const { matched } = useVerdict('tor', { min: 'high' })  // block only when certain
const { matched } = useVerdict('tor', { min: 'low' })   // observe everything
```

## A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It accepts a getter, and is read at submission time rather than
at render time:

```tsx
const { identify } = useIdentify({ tag: () => `checkout:${params.orderId}` })
```

## Collect without submitting

For a page that wants the local verdicts and nothing else:

```tsx
<FingerlyProvider apiKey="fly_pk_production_…" submit={false}>
```

Everything the server decides comes back empty: no `requestId`, no `visitorId`,
and `suspectScore` is `null` rather than `0`. That is the honest answer rather
than a gap: nothing was sent, so nobody scored it, and a `0` would read as
"scored, found nothing".

## Waiting for consent

Consent defaults to `pending`. If identifying a visitor needs their consent
first, pass what your consent tool says now. Until it is `granted` nothing is
collected and nothing is sent:
`useIdentify({ immediate: true })` and `suspend` wait, and the client is not
even built.

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
  visitorId,         // string | null:        who the server decided this is
  visitorIsNew,      // boolean:              never seen before
  visitorConfidence, // number:               0 to 100
  identifiable,      // boolean:              false when the signals were too thin
  duplicate,         // boolean:              answered before; this is the first answer
  state,             // string | null:        the server's disposition
  reason,            // string | null:        why, when state needs explaining
  suspectScore,      // number | null:        null when nothing scored it
  suspectLevel,      // string | null:        low, medium, high
  triggers,          // IdentifyTrigger[]:    what the server scored on
  verdicts,          // Verdicts | null:      the six local verdicts
  report,            // SignalReport | null:  every source, with status and timing
  error,             // Error | null
  consent,           // ConsentState        (granted, pending or denied)
  isLoading,    // boolean
  isReady,      // boolean:              finished, successfully or not
  isSuspicious, // boolean:              any verdict at medium+
  identify,     // () => Promise<IdentifyResult>
  refresh,      // () => Promise<IdentifyResult>
} = useIdentify()
```

`identify` and `refresh` are stable across renders, so they can go in a
dependency array without restarting anything.

`suspectScore` is `null`, not `0`, when nothing scored the submission. `0`
means "scored, nothing fired". `visitorId` and the rest of the server's fields
are empty under `submit: false`.

A verdict is `{ value, confidence, reasons }`. `reasons` is ordered strongest
first, and exists because a boolean that cannot say why it is true is not
something you can defend to a customer whose user you blocked.

These verdicts are **advisory**. The same detectors run again server-side over
the stored report, where the rules improve without every integration
redeploying. Treat the client's answer as a hint for the UI and the server's as
the decision.

## The visitor is never asked for anything

No permission prompt, no picker, no dialog, on any browser. Reading a
permission's *state* prompts nobody and is used freely; requesting is banned
outright and enforced by a test in `@fingerly/web-js`. The one API that prompts on
some browsers (canvas readback, which raises a doorhanger in Tor Browser) is
skipped when the SDK measures a clamped clock.

You can drop this into a checkout without it ever interrupting the checkout.

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
the client.

## Running the demo

`demo/` is this package's hooks driving the real SDK (no mocks) under
`StrictMode`, with `useIdentify({ suspend: true })` and a `useVerdict()` card
per verdict, all sharing one identification.

```
pnpm --filter @fingerly/react demo   # http://localhost:4175
```

It is served rather than opened from disk because several sources need a secure
context and `file://` is not one; the incognito verdict is the clearest case,
since the probe it rests on is not exposed outside one. It uses `submit: false`,
so it sends nothing.

Open it twice, in an ordinary window and a private one, and watch the incognito
card change. That pair is the only real test that verdict gets.
