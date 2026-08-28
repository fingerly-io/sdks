# @badele/svelte

Svelte bindings for the Badele SDK. One state per app, held in Svelte's
context, read as plain reactive properties.

Requires Svelte **5**. The state is built with runes, which is what lets a
component read `badele.verdicts` and re-render with no store, no subscription
and no `$` prefix at the call site.

```
pnpm add @badele/svelte
```

## Set it up

```svelte
<!-- +layout.svelte, or your root component -->
<script lang="ts">
  import { setupBadele } from '@badele/svelte'

  setupBadele({ apiKey: 'pk_live_…' })
</script>

<slot />
```

The key is a **public** SDK key from the dashboard, and it belongs in the page —
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

Setting up collects nothing. It makes the client reachable and no more; when to
identify is the page's decision. Like every Svelte context call it has to run
during component initialisation — a `<script>` block, not an event handler and
not an `$effect`.

## Identify

```svelte
<script lang="ts">
  import { useIdentify } from '@badele/svelte'

  const badele = useIdentify()

  async function submit() {
    await badele.identify()

    if (badele.isSuspicious) {
      // step up to MFA, hold for review, add friction
    }
  }
</script>

<button onclick={submit} disabled={badele.isLoading}>
  {badele.isLoading ? 'Checking…' : 'Continue'}
</button>

{#if badele.error}<p>{badele.error.message}</p>{/if}
```

`identify()` collects, scores locally, and submits. It resolves as soon as the
server has a receipt — IP geolocation and the velocity windows are computed
after the response, so what comes back is a `requestId` rather than a finished
event.

### On mount instead

```svelte
<script lang="ts">
  const badele = useIdentify({ immediate: true })
</script>
```

`immediate` runs in an `$effect`, which is what makes it **safe under SSR** —
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
<!-- Header.svelte, CheckoutForm.svelte, RiskBanner.svelte — all three: -->
const badele = useIdentify({ immediate: true })
<!-- → one network request, one shared answer -->
```

Context rather than a module-level singleton, and the reason is the server: a
module-level state on a SvelteKit server is shared by every request the process
renders. Context is per component tree, and a component tree is per request.

To deliberately identify again — a long-lived app reaching a second checkout:

```svelte
await badele.refresh() // ignores the cached result and collects afresh
```

## A single verdict

```svelte
<script lang="ts">
  import { useVerdict } from '@badele/svelte'

  const automation = useVerdict('automation')
</script>

{#if automation.matched}
  <aside>
    Automated access suspected ({automation.confidence})
    <ul>{#each automation.reasons as reason (reason)}<li>{reason}</li>{/each}</ul>
  </aside>
{/if}
```

Names: `incognito` · `tor` · `emulator` · `automation` · `farm`.

`matched` requires **medium confidence or better** by default. A
`low`-confidence verdict is a single weak tell — one removable flag, or one
countermeasure a privacy-conscious real user might equally be running — and
acting on it would generate false positives. Raise or lower it explicitly:

```ts
const tor = useVerdict('tor', { min: 'high' })  // block only when certain
const tor = useVerdict('tor', { min: 'low' })   // observe everything
```

Both arguments accept a getter as well as a value, because this is called once
when the component initialises and its arguments may be props that change after
that:

```svelte
const verdict = useVerdict(() => name, { min: () => threshold })
```

## A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It accepts a getter, and is read at submission time rather than
at initialisation:

```ts
const badele = useIdentify({ tag: () => `checkout:${page.params.orderId}` })
```

## Collect without submitting

For a page that wants the local verdicts and nothing else:

```ts
setupBadele({ apiKey: 'pk_live_…', submit: false })
```

`requestId` stays `null`, which is the honest answer — nothing was sent, so
there is nothing to fetch later.

## What you get back

```ts
const badele = useIdentify()

badele.requestId    // string | null       — correlates the enriched event
badele.verdicts     // Verdicts | null     — the five local verdicts
badele.report       // SignalReport | null — every source, with status and timing
badele.error        // Error | null
badele.isLoading    // boolean
badele.isReady      // boolean             — finished, successfully or not
badele.isSuspicious // boolean             — any verdict at medium+
badele.identify()   // Promise<IdentifyResult>
badele.refresh()    // Promise<IdentifyResult>
```

Every field is a getter over a rune, so reading one in a template subscribes to
it and reading one in an event handler gets the current value. None of them is
settable: the state is shared, so a component that could assign to it would be
changing what every other component sees.

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
  await badele.identify()
} catch (error) {
  // your own handling
}
```

```svelte
{#if badele.error}<p>{badele.error.message}</p>{/if}
```

A failed identification is forgotten rather than remembered, so the next call
tries again instead of being handed the same rejection.

`TransportError` carries a `status`. The two worth branching on are `401` (the
key is wrong, or was used from an origin it does not list) and `402` (the
organisation is not accepting traffic) — both are your configuration rather than
the visitor's.

Calling `identify()` during SSR rejects with `BadeleServerError` and a message
saying what to do instead. Use `{ immediate: true }`, which already waits for
the client.

## Running the playground

`playground/` is this package's own state and hooks driving the real SDK — no
mocks — with a `useVerdict()` card per verdict, all sharing one identification.

```
pnpm --filter @badele/svelte playground   # http://localhost:4176
```

Open it twice — an ordinary window and a private one — and watch the incognito
card change. That pair is the only real test that verdict gets.

## A note on the build

The package is emitted by `tsc`, not bundled, and that is a requirement rather
than a preference. The runes in `*.svelte.js` are compiled by the *app's*
Svelte plugin, which decides what to compile by the file name — bundling them
into an `index.js` would hand the app a file full of `$state(…)` that nothing
compiles, and `$state is not defined` at runtime.
