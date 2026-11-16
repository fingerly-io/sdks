# @fingerly/angular

Angular bindings for the Fingerly SDK (`0.3.0`, single-pass `v: 3`). One `1-RTT`
identification per application injector, exposed as read-only Angular signals.

Requires Angular **19 or newer** (signals, `afterNextRender`, standalone
bootstrap). Tested against Angular 22.

```sh
pnpm add @fingerly/angular@^0.3.0
```

**Not for apps.** This binding runs `@fingerly/web-js`, which skips all
device-fingerprinting collectors inside embedded app WebViews (`WKWebView`,
Android `WebView`, Capacitor, Cordova, Ionic, React Native WebView, Flutter
WebView, Electron) to preserve Apple DPLA §3.3.3(B) compliance, running only the
non-identifying `EMBEDDED_SAFE_SOURCES` subset and returning `visitorId: ""`
under Option B. Use the native Fingerly iOS or Android SDK (or the React Native,
Flutter, or Lynx bridge) in an app; see [docs/privacy.md §3.3](../../../docs/privacy.md).

## Provide it

```ts
// app.config.ts
import { provideFingerly } from '@fingerly/angular'

export const appConfig: ApplicationConfig = {
  // consent: 'granted' only once you have consent (or know none is required here; see docs/privacy.md §4)
  providers: [
    provideFingerly({
      apiKey: 'fly_pk_production_…',
      consent: 'granted',
      incognitoDetection: 'standard',
    }),
  ],
}
```

The key is a **public** SDK key from the dashboard, and it belongs in the page:
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

These are environment providers, so they belong in `bootstrapApplication` or a
route's providers and cannot be dropped into a component's, which matters
here: providing it per component would give each one its own identification,
and the one-submission-per-page rule would quietly stop holding.

Providing it collects nothing. The state is built the first time something
injects it, and it collects only when asked.

Consent defaults to `pending`, and nothing is collected or sent until it is
`granted`. A page with a consent banner leaves it `pending` and calls
`setConsent('granted')` once the banner is accepted; see
[Waiting for consent](#waiting-for-consent).

## Serve it from your own site

Content blockers refuse requests to third-party hosts. Mount a first-party
proxy at the path the dashboard issued (see `@fingerly/node` or the proxy
templates) and pass that path as `endpoints`, a string or an array compared by
its contents:

```ts
provideFingerly({ apiKey: 'fly_pk_production_…', endpoints: '/k7x2qm4a', consent: 'granted' })
```

## Identify (single-pass `v: 3`, `<= 350 ms` budget)

```ts
@Component({
  template: `
    <button (click)="submit()" [disabled]="fingerly.isLoading()">
      {{ fingerly.isLoading() ? 'Checking…' : 'Continue' }}
    </button>
    @if (challenge()) { <step-up /> }
    @if (fingerly.error(); as failure) { <p>{{ failure.message }}</p> }
  `,
})
export class Checkout {
  readonly orderId = input.required<string>()
  readonly fingerly = injectIdentify({ tag: () => `checkout:${this.orderId()}` })
  readonly challenge = signal(false)
  private readonly http = inject(HttpClient)

  async submit() {
    const { requestId } = await this.fingerly.identify()

    // The page only forwards the request ID. Your backend reads the event with
    // the secret key and decides; the page acts on that decision.
    const { decision } = await firstValueFrom(
      this.http.post<{ decision: string }>('/api/checkout', { orderId: this.orderId(), requestId }),
    )
    this.challenge.set(decision === 'challenge')
  }
}
```

`identify()` runs a single-pass browser collection (`<= 350 ms` default budget,
including the Stage 1 Gecko `<= 3 ms` RFP timer guard and CSP-safe
`worker_realm` check) and submits once in **1 RTT** to `POST /api/v1/ingest`,
resolving with the server's answer: `requestId`, `visitorId`, `identifiable`,
and `suspectScore` / `suspectLevel` (unless hidden by the key). Nothing is
decided in the page: scoring lives on the server, under the weights you set.
Each report carries a single-use freshness ticket, held in memory only; when
none is held, the ticket request runs in parallel with collection and never
holds up or fails `identify()`.

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
// post, as your framework resolves it behind your own proxies.
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

`isSuspicious()`, `suspectScore()` and `suspectLevel()` in the page are a UI
hint only (for example, to show a spinner a little longer). Never gate an
action on them. One event can back more than one decision inside the recency
window; for a flow that must be single use, record the `requestId` with the
outcome and refuse one you have already seen.

### On render instead

```ts
readonly fingerly = injectIdentify({ immediate: true })
```

`immediate` runs in `afterNextRender`, which is what makes it **safe under
SSR**: Angular does not run those callbacks during a server render, so a page
renders on the server and collects in the browser with no platform check of its
own.

Pass it in as many components as want it. The state is shared, so the second
and third callers get the first one's answer rather than starting their own
submission.

### Incognito detection (`'standard' | 'extended'`)

Pass `incognitoDetection` on `provideFingerly()`, `injectIdentify()` (accepts a
value or signal/getter), or `identify()` / `refresh()`: `'standard'` (default)
runs zero-write probes, while `'extended'` opts into Chromium IndexedDB
`storage_durability` timing within the single-pass budget.

## One identification per page

The state is a single provided value, not one per component. Three components
asking whether the visitor is suspicious produce **one** submission, one
`requestId`, and one line on your bill:

```ts
// All three of Header, CheckoutForm, RiskBanner:
readonly fingerly = injectIdentify({ immediate: true })
// → one network request, one shared answer
```

To deliberately identify again (a long-lived app reaching a second checkout):

```ts
await this.fingerly.refresh() // ignores the cached result and collects afresh
```

## Reading the answer & Option B

`suspectLevel()` is the server's band for this submission, under the weights you
set. `isSuspicious()` is `true` for `medium` or `high`, `false` for `low`, and
`null` when the level is absent: no server has answered yet, the submission went
unscored, or the SDK key hides the score from the page. Null is not a clean
result.

Under **Option B** (`v: 3`), `fingerly.visitorId()` is `null` before the first
identification completes, and afterwards holds `result.visitorId`, which is
`""` (with `fingerly.visitorIsNew() === false`) whenever
`fingerly.identifiable() === false`, inside an embedded WebView, or when an
unmatched Web report is high-risk.

Signals are read on your backend, by `requestId`, never in the page: which check
tripped is what a fraudster wants to learn.

## A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It takes a signal or getter, and is read at submission time
rather than at construction:

```ts
readonly orderId = input.required<string>()
readonly fingerly = injectIdentify({ tag: () => `checkout:${this.orderId()}` })
```

## Local collection without submitting (`collect()`)

For a debug page that wants to inspect the raw `SignalReport` locally without
posting to `/api/v1/ingest`, call `collect()` on the underlying client:

```ts
const client = await this.fingerly.client()
const report = await client.collect()
```

`collect()` still requires `consent === 'granted'` and rejects with
`ConsentError` otherwise.

## Waiting for consent

If identifying a visitor needs their consent first, provide it with `consent:
'pending'`, the default. Until it is `granted` nothing is collected and nothing
is sent: `injectIdentify({ immediate: true })` waits, and the client is not even
built.

```ts
provideFingerly({ apiKey: 'fly_pk_production_…', consent: 'pending' })
```

Then set it from wherever your consent tool reports the answer:

```ts
readonly fingerly = injectFingerly()

onConsentAnswered(accepted: boolean) {    // the consent tool's callback
  this.fingerly.setConsent(accepted ? 'granted' : 'denied')
}
```

- `consent`: `'pending'` (the default), `'granted'` or `'denied'`, an option to
  `provideFingerly()`.
- `setConsent(state)`: on `injectFingerly()` and `injectIdentify()`, and on the
  client (`await fingerly.client()`). Synchronous, and setting the current value
  again does nothing.
- `fingerly.consent()`: the current state as a signal, for rendering a banner.

Setting `granted` starts the identification that was waiting, once. `pending`
and `denied` behave the same. Withdrawing consent while an identification is
running stops it before it submits, and it fails with a `ConsentError`.

## Where these can be called

`injectFingerly` and `injectIdentify` use Angular's `inject()`, so like
everything that does, they run in an **injection context**: a field initialiser,
a constructor, or inside `runInInjectionContext`. That is why they are named
`inject…` rather than the `use…` the Vue, React and Svelte bindings use: the
name is the rule.

## What you get back

```ts
const fingerly = injectIdentify()

fingerly.requestId()         // string | null:        identifies this submission
fingerly.visitorId()         // string | null:        null before completion; "" when identifiable === false (Option B)
fingerly.visitorIsNew()      // boolean:              true only when a new visitor was minted
fingerly.visitorConfidence() // number:               0 to 100
fingerly.identifiable()      // boolean:              false when the signals were too thin
fingerly.duplicate()         // boolean:              answered before; this is the cached answer
fingerly.state()             // string | null:        the server's disposition
fingerly.suspectScore()      // number | null:        null when unscored or hidden by the key
fingerly.suspectLevel()      // string | null:        low, medium, high
fingerly.identified()        // boolean:              an identification has succeeded
fingerly.error()             // Error | null
fingerly.consent()           // ConsentState        (granted, pending or denied)
fingerly.isLoading()         // boolean
fingerly.isReady()           // boolean:              finished, successfully or not
fingerly.isSuspicious()      // boolean | null:       UI hint only; true for medium or high, null when absent
fingerly.identify()          // Promise<IdentifyAnswer>
fingerly.refresh()           // Promise<IdentifyAnswer>
fingerly.setConsent('granted')
```

Signals, not observables: a template reads `fingerly.isLoading()` and
re-renders, with no subscription to manage and nothing to unsubscribe from, and
it works in a zoneless application. They are read-only.

The binding never keeps the signal report: `identify()` resolves with the
server's answer (`IdentifyAnswer`, the result without `report`), and nothing of
the report stays in state. Use `collect()`
([Local collection without submitting](#local-collection-without-submitting))
to inspect one.

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
  await this.fingerly.identify()
} catch (error) {
  // your own handling
}
```

```html
@if (fingerly.error(); as failure) { <p>{{ failure.message }}</p> }
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
`identify()` during a server render rejects with `FingerlyServerError`; use
`{ immediate: true }`, which waits for the browser.

## No decorators, and why

There is no `@Injectable` here: the state is an injection token with a factory.
That is what lets the package build with `tsc` and be consumed without an
Angular compilation step of its own: nothing in `dist` needs the Angular
compiler to have seen it.

## Running the playground

```sh
pnpm --filter @fingerly/angular playground   # http://localhost:4177
```
