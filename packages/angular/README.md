# @badele/angular

Angular bindings for the Badele SDK. One identification per application
injector, exposed as signals.

Requires Angular **19 or newer** (signals, `afterNextRender`, standalone
bootstrap). Tested against Angular 22.

```
pnpm add @badele/angular
```

## Provide it

```ts
// app.config.ts
import { provideBadele } from '@badele/angular'

export const appConfig: ApplicationConfig = {
  providers: [provideBadele({ apiKey: 'pk_live_…' })],
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

## Identify

```ts
@Component({
  template: `
    <button (click)="submit()" [disabled]="badele.isLoading()">
      {{ badele.isLoading() ? 'Checking…' : 'Continue' }}
    </button>
    @if (badele.error(); as failure) { <p>{{ failure.message }}</p> }
  `,
})
export class Checkout {
  readonly badele = injectIdentify()

  async submit() {
    await this.badele.identify()

    if (this.badele.isSuspicious()) {
      // step up to MFA, hold for review, add friction
    }
  }
}
```

`identify()` collects, scores locally, and submits. It resolves as soon as the
server has a receipt — IP geolocation and the velocity windows are computed
after the response, so what comes back is a `requestId` rather than a finished
event.

### On render instead

```ts
readonly badele = injectIdentify({ immediate: true })
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
readonly badele = injectIdentify({ immediate: true })
// → one network request, one shared answer
```

To deliberately identify again — a long-lived app reaching a second checkout:

```ts
await this.badele.refresh() // ignores the cached result and collects afresh
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
readonly badele = injectIdentify({ tag: () => `checkout:${this.orderId()}` })
```

## Collect without submitting

For an app that wants the local verdicts and nothing else:

```ts
provideBadele({ apiKey: 'pk_live_…', submit: false })
```

Everything the server decides comes back empty: no `requestId`, no `visitorId`,
and `suspectScore` is `null` rather than `0`. That is the honest answer rather
than a gap — nothing was sent, so nobody scored it, and a `0` would read as
"scored, found nothing".

## Where these can be called

`injectBadele`, `injectIdentify` and `injectVerdict` use Angular's `inject()`,
so like everything that does, they run in an **injection context**: a field
initialiser, a constructor, or inside `runInInjectionContext`. That is why they
are named `inject…` rather than the `use…` the Vue, React and Svelte bindings
use — the name is the rule.

## What you get back

```ts
const badele = injectIdentify()

badele.requestId()         // string | null       — identifies this submission
badele.visitorId()         // string | null       — who the server decided this is
badele.visitorIsNew()      // boolean             — never seen before
badele.visitorConfidence() // number              — 0 to 100
badele.identifiable()      // boolean             — false when the signals were too thin
badele.duplicate()         // boolean             — answered before; this is the first answer
badele.state()             // string | null       — the server's disposition
badele.reason()            // string | null       — why, when state needs explaining
badele.suspectScore()      // number | null       — null when nothing scored it
badele.suspectLevel()      // string | null       — low, medium, high
badele.triggers()          // IdentifyTrigger[]   — what the server scored on
badele.verdicts()          // Verdicts | null     — the five local verdicts
badele.report()            // SignalReport | null — every source, with status and timing
badele.error()             // Error | null
badele.isLoading()    // boolean
badele.isReady()      // boolean             — finished, successfully or not
badele.isSuspicious() // boolean             — any verdict at medium+
badele.identify()     // Promise<IdentifyResult>
badele.refresh()      // Promise<IdentifyResult>
```

Signals, not observables: a template reads `badele.isSuspicious()` and
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
outright and enforced by a test in `@badele/web-js`. The one API that prompts on
some browsers — canvas readback, which raises a doorhanger in Tor Browser — is
skipped when the SDK measures a clamped clock.

You can drop this into a checkout without it ever interrupting the checkout.

## Errors

`identify()` both stores the error and rethrows it, so either style works:

```ts
try {
  await this.badele.identify()
} catch (error) {
  // your own handling
}
```

```html
@if (badele.error(); as failure) { <p>{{ failure.message }}</p> }
```

A failed identification is forgotten rather than remembered, so the next call
tries again instead of being handed the same rejection.

`TransportError` carries a `status`. The two worth branching on are `401` (the
key is wrong, or was used from an origin it does not list) and `402` (the
organisation is not accepting traffic) — both are your configuration rather than
the visitor's.

Calling `identify()` during a server render rejects with `BadeleServerError`
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
pnpm --filter @badele/angular playground   # http://localhost:4177
```

Open it twice — an ordinary window and a private one — and watch the incognito
card change. That pair is the only real test that verdict gets.
