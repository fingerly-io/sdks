# @fingerly/angular

Angular bindings for the Fingerly SDK. One identification per application
injector, exposed as signals.

Requires Angular **19 or newer** (signals, `afterNextRender`, standalone
bootstrap). Tested against Angular 22.

```
pnpm add @fingerly/angular
```

## Provide it

```ts
// app.config.ts
import { provideFingerly } from '@fingerly/angular'

export const appConfig: ApplicationConfig = {
  // consent: 'granted' only once you have consent (or another lawful basis)
  providers: [provideFingerly({ apiKey: 'fly_pk_production_…', consent: 'granted' })],
}
```

The key is a **public** SDK key from the dashboard, and it belongs in the page —
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

These are environment providers, so they belong in `bootstrapApplication` or a
route's providers and cannot be dropped into a component's — which matters
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

## Identify

```ts
@Component({
  template: `
    <button (click)="submit()" [disabled]="fingerly.isLoading()">
      {{ fingerly.isLoading() ? 'Checking…' : 'Continue' }}
    </button>
    @if (fingerly.error(); as failure) { <p>{{ failure.message }}</p> }
  `,
})
export class Checkout {
  readonly fingerly = injectIdentify()

  async submit() {
    await this.fingerly.identify()

    if (this.fingerly.isSuspicious()) {
      // step up to MFA, hold for review, add friction
    }
  }
}
```

`identify()` collects, scores locally, and submits, and resolves with the
server's verdict in the same round trip: the `requestId`, who the visitor is
(`visitorId`), and the `suspectScore`, `suspectLevel` and triggers behind it.

### On render instead

```ts
readonly fingerly = injectIdentify({ immediate: true })
```

`immediate` runs in `afterNextRender`, which is what makes it **safe under
SSR** — Angular does not run those callbacks during a server render, so a page
renders on the server and collects in the browser with no platform check of its
own.

Pass it in as many components as want it. The state is shared, so the second
and third callers get the first one's answer rather than starting their own
submission.

## One identification per page

The state is a single provided value, not one per component. Three components
asking whether the visitor is suspicious produce **one** submission, one
`requestId`, and one line on your bill:

```ts
// Header, CheckoutForm, RiskBanner — all three:
readonly fingerly = injectIdentify({ immediate: true })
// → one network request, one shared answer
```

To deliberately identify again — a long-lived app reaching a second checkout:

```ts
await this.fingerly.refresh() // ignores the cached result and collects afresh
```

## A single verdict

```ts
@Component({
  template: `
    @if (automation.matched()) {
      <aside>
        Automated access suspected ({{ automation.confidence() }})
        <ul>
          @for (reason of automation.reasons(); track reason) { <li>{{ reason }}</li> }
        </ul>
      </aside>
    }
  `,
})
export class AutomationNotice {
  readonly automation = injectVerdict('automation')
}
```

Names: `incognito` · `tor` · `emulator` · `automation` · `farm`.

`matched()` requires **medium confidence or better** by default. A
`low`-confidence verdict is a single weak tell — one removable flag, or one
countermeasure a privacy-conscious real user might equally be running — and
acting on it would generate false positives. Raise or lower it explicitly:

```ts
readonly tor = injectVerdict('tor', { min: 'high' })  // block only when certain
readonly tor = injectVerdict('tor', { min: 'low' })   // observe everything
```

Both arguments take a signal as well as a value, so an input can decide which
verdict a component watches:

```ts
readonly which = input.required<VerdictName>()
readonly verdict = injectVerdict(this.which)
```

## A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It takes a signal, and is read at submission time rather than
at construction:

```ts
readonly orderId = input.required<string>()
readonly fingerly = injectIdentify({ tag: () => `checkout:${this.orderId()}` })
```

## Collect without submitting

For an app that wants the local verdicts and nothing else:

```ts
provideFingerly({ apiKey: 'fly_pk_production_…', submit: false })
```

Everything the server decides comes back empty: no `requestId`, no `visitorId`,
and `suspectScore` is `null` rather than `0`. That is the honest answer rather
than a gap — nothing was sent, so nobody scored it, and a `0` would read as
"scored, found nothing".

## Waiting for consent

If identifying a visitor needs their consent first, provide it with `consent:
'pending'`, the default. Until it is `granted` nothing is collected and nothing is sent:
`injectIdentify({ immediate: true })` waits, and the client is not even built.

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

`injectFingerly`, `injectIdentify` and `injectVerdict` use Angular's `inject()`,
so like everything that does, they run in an **injection context**: a field
initialiser, a constructor, or inside `runInInjectionContext`. That is why they
are named `inject…` rather than the `use…` the Vue, React and Svelte bindings
use — the name is the rule.

## What you get back

```ts
const fingerly = injectIdentify()

fingerly.requestId()         // string | null       — identifies this submission
fingerly.visitorId()         // string | null       — who the server decided this is
fingerly.visitorIsNew()      // boolean             — never seen before
fingerly.visitorConfidence() // number              — 0 to 100
fingerly.identifiable()      // boolean             — false when the signals were too thin
fingerly.duplicate()         // boolean             — answered before; this is the first answer
fingerly.state()             // string | null       — the server's disposition
fingerly.reason()            // string | null       — why, when state needs explaining
fingerly.suspectScore()      // number | null       — null when nothing scored it
fingerly.suspectLevel()      // string | null       — low, medium, high
fingerly.triggers()          // IdentifyTrigger[]   — what the server scored on
fingerly.verdicts()          // Verdicts | null     — the five local verdicts
fingerly.report()            // SignalReport | null — every source, with status and timing
fingerly.error()             // Error | null
fingerly.consent()           // ConsentState        (granted, pending or denied)
fingerly.isLoading()    // boolean
fingerly.isReady()      // boolean             — finished, successfully or not
fingerly.isSuspicious() // boolean             — any verdict at medium+
fingerly.identify()     // Promise<IdentifyResult>
fingerly.refresh()      // Promise<IdentifyResult>
fingerly.setConsent('granted')
```

Signals, not observables: a template reads `fingerly.isSuspicious()` and
re-renders, with no subscription to manage and nothing to unsubscribe from, and
it works in a zoneless application. They are read-only — the writable signals
stay inside the factory, because the state is shared and a component that could
`set()` it would be changing what every other component sees.

A verdict is `{ value, confidence, reasons }` — `reasons` is ordered strongest
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
some browsers — canvas readback, which raises a doorhanger in Tor Browser — is
skipped when the SDK measures a clamped clock.

You can drop this into a checkout without it ever interrupting the checkout.

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
same error until that time has passed; the error carries it as
`retryAfterMs`. After a transient failure without one (a `5xx`, a network
error), components that identify automatically wait 5 seconds, doubling per
consecutive failure up to a minute, so route changes during an outage send
nothing; a call you make yourself, such as on a click, still tries at once.
Any other failure, such as a wrong key, is tried again on the next call.

`TransportError` carries a `status`. The two worth branching on are `401` (the
key is wrong, or was used from an origin it does not list) and `402` (the
organisation is not accepting traffic) — both are your configuration rather than
the visitor's.

`ConsentError` means consent is not `granted`. It carries `code:
'consent_required'` and the `state`, and lands in `error()` like any other
failure. `{ immediate: true }` waits for consent rather than producing one, so
it only sees this error when consent is withdrawn while it runs.

Calling `identify()` during a server render rejects with `FingerlyServerError`
and a message saying what to do instead. Use `{ immediate: true }`, which
already waits for the browser.

## No decorators, and why

There is no `@Injectable` here: the state is an injection token with a factory.
That is what lets the package build with `tsc` and be consumed without an
Angular compilation step of its own — nothing in `dist` needs the Angular
compiler to have seen it.

## Running the playground

`playground/` is this package's own providers and injectors driving the real
SDK — no mocks — in an application compiled just-in-time in the page, so it
needs no second build system.

```
pnpm --filter @fingerly/angular playground   # http://localhost:4177
```

Open it twice — an ordinary window and a private one — and watch the incognito
card change. That pair is the only real test that verdict gets.
