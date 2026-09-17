# @fingerly/vue

Vue 3 bindings for the Fingerly SDK. A plugin, three composables, and one shared
result per page.

Requires Vue **3.3 or newer** (it uses `hasInjectionContext`, `toValue` and
`MaybeRefOrGetter`). Tested against 3.5.

```
pnpm add @fingerly/vue
```

## Install the plugin

```ts
// main.ts
import { createApp } from 'vue'
import { createFingerly } from '@fingerly/vue'
import App from './App.vue'

createApp(App)
  .use(createFingerly({ apiKey: 'fly_pk_us_production_…' }))
  .mount('#app')
```

The key is a **public** SDK key from the dashboard, and it belongs in the page —
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

Installing the plugin collects nothing. It makes the client available and
nothing more; when to identify is the page's decision, not the plugin's.

## Identify

```vue
<script setup lang="ts">
import { useIdentify } from '@fingerly/vue'

const { identify, verdicts, isSuspicious, isLoading, error } = useIdentify()

async function onSubmit() {
  await identify()

  if (isSuspicious.value) {
    // step up to MFA, hold for review, add friction
  }
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <button :disabled="isLoading">
      {{ isLoading ? 'Checking…' : 'Continue' }}
    </button>
  </form>
  <p v-if="error">{{ error.message }}</p>
</template>
```

`identify()` collects, scores locally, and submits. It resolves as soon as the
server has a receipt — IP geolocation and the velocity windows are computed
after the response, so what comes back is a `requestId` rather than a finished
event.

### On mount instead

```vue
<script setup lang="ts">
const { verdicts, isReady } = useIdentify({ immediate: true })
</script>
```

`immediate` runs in `onMounted`, which is what makes it **safe under SSR** — the
hook does not run on the server, so a Nuxt page using this renders server-side
and collects on the client with no guard of its own.

Pass it in as many components as want it. The result is shared (see below), so
the second and third callers get the first one's answer rather than starting
their own submission.

## One identification per page

State lives on the app, not in each `useIdentify()` call. Three components
asking whether the visitor is suspicious produce **one** submission, one
`requestId`, and one line on your bill:

```ts
// Header.vue, CheckoutForm.vue, RiskBanner.vue — all three:
const { verdicts } = useIdentify({ immediate: true })
// → one network request, one shared answer
```

To deliberately identify again — a long-lived SPA reaching a second checkout:

```ts
const { refresh } = useIdentify()
await refresh() // ignores the cached result and collects afresh
```

## A single verdict

`useVerdict()` is for the common case where a component cares about exactly one
question:

```vue
<script setup lang="ts">
import { useVerdict } from '@fingerly/vue'

const { matched, confidence, reasons } = useVerdict('automation')
</script>

<template>
  <aside v-if="matched">
    Automated access suspected ({{ confidence }})
    <ul><li v-for="r in reasons" :key="r">{{ r }}</li></ul>
  </aside>
</template>
```

Names: `incognito` · `tor` · `emulator` · `automation` · `farm`.

`matched` requires **medium confidence or better** by default. A
`low`-confidence verdict is a single weak tell — one removable flag, or one
countermeasure a privacy-conscious real user might equally be running — and
acting on it would generate false positives. Raise or lower it explicitly:

```ts
const { matched } = useVerdict('tor', { min: 'high' })  // block only when certain
const { matched } = useVerdict('tor', { min: 'low' })   // observe everything
```

## A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It accepts a ref or a getter, and is read at submission time
rather than at setup time:

```ts
const route = useRoute()
const { identify } = useIdentify({ tag: () => `checkout:${route.params.orderId}` })
```

## Collect without submitting

For a page that wants the local verdicts and nothing else:

```ts
app.use(createFingerly({ apiKey: 'fly_pk_us_production_…', submit: false }))
```

Everything the server decides comes back empty: no `requestId`, no `visitorId`,
and `suspectScore` is `null` rather than `0`. That is the honest answer rather
than a gap — nothing was sent, so nobody scored it, and a `0` would read as
"scored, found nothing".

## Waiting for consent

If identifying a visitor needs their consent first, install the plugin with
`consent: 'pending'`. Until it is `granted` nothing is collected and nothing is
sent: `useIdentify({ immediate: true })` waits, and the client is not even
built.

```ts
app.use(createFingerly({ apiKey: 'fly_pk_us_production_…', consent: 'pending' }))
```

Then set it from wherever your consent tool reports the answer:

```ts
const fingerly = useFingerly()             // or this.$fingerly
fingerly.setConsent('granted')             // from the consent tool's callback

const client = await fingerly.client()
client.setConsent('denied')                // the same, on the client itself
```

- `consent`: `'granted'` (the default), `'pending'` or `'denied'`, an option to
  `createFingerly()`.
- `setConsent(state)`: on `useFingerly()` and `this.$fingerly`, and on the
  client. Synchronous, and setting the current value again does nothing.
- `consent` in `useIdentify()`: the current state as a readonly ref, for
  rendering a banner.

Setting `granted` starts the identification that was waiting, once. `pending`
and `denied` behave the same. Withdrawing consent while an identification is
running stops it before it submits, and it fails with a `ConsentError`.

## Options API

Not every Vue 3 component is `<script setup>`, and a fraud check is exactly the
kind of thing that gets retrofitted. The context is on `this.$fingerly`:

```vue
<script lang="ts">
export default {
  data: () => ({ suspicious: false }),
  async mounted() {
    const { verdicts } = await this.$fingerly.identify()
    this.suspicious = verdicts.automation.value
  },
}
</script>
```

## What you get back

```ts
const {
  requestId,         // Ref<string | null>       — identifies this submission
  visitorId,         // Ref<string | null>       — who the server decided this is
  visitorIsNew,      // Ref<boolean>             — never seen before
  visitorConfidence, // Ref<number>              — 0 to 100
  identifiable,      // Ref<boolean>             — false when the signals were too thin
  duplicate,         // Ref<boolean>             — answered before; this is the first answer
  state,             // Ref<string | null>       — the server's disposition
  reason,            // Ref<string | null>       — why, when state needs explaining
  suspectScore,      // Ref<number | null>       — null when nothing scored it
  suspectLevel,      // Ref<string | null>       — low, medium, high
  triggers,          // Ref<IdentifyTrigger[]>   — what the server scored on
  verdicts,          // Ref<Verdicts | null>     — the five local verdicts
  report,            // Ref<SignalReport | null> — every source, with status and timing
  error,             // Ref<Error | null>
  consent,           // Ref<ConsentState>        (granted, pending or denied)
  isLoading,    // Ref<boolean>
  isReady,      // ComputedRef<boolean>    — finished, successfully or not
  isSuspicious, // ComputedRef<boolean>    — any verdict at medium+
  identify,     // () => Promise<IdentifyResult>
  refresh,      // () => Promise<IdentifyResult>
} = useIdentify()
```

Every ref is **readonly**. The state is shared, so a component that could assign
to it would be changing what every other component sees.

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
  await identify()
} catch (e) {
  // your own handling
}
```

```vue
<p v-if="error">{{ error.message }}</p>
```

`TransportError` carries a `status`. The two worth branching on are `401` (the
key is wrong, or was used from an origin it does not list) and `402` (the
organisation is not accepting traffic) — both are your configuration rather than
the visitor's.

`ConsentError` means consent is not `granted`. It carries `code:
'consent_required'` and the `state`, and lands in `error` like any other
failure. `{ immediate: true }` waits for consent rather than producing one, so
it only sees this error when consent is withdrawn while it runs.

Calling `identify()` during SSR rejects with `FingerlyServerError` and a message
saying what to do instead. Use `{ immediate: true }`, which already waits for
the client.

## Running the demo

`demo/` is this package's composables driving the real SDK — no mocks — with
`useIdentify({ immediate: true })` in the root and a `useVerdict()` card per
verdict, all sharing one identification.

```
pnpm --filter @fingerly/vue demo   # http://localhost:4174
```

That bundles `demo/main.ts` — the binding, the SDK and Vue's runtime in one
file, because `demo/index.html` is a plain `<script>` tag — and serves it.

It is served rather than opened from disk because several sources need a
secure context and `file://` is not one; the incognito verdict is the clearest
case, since the probe it rests on is not exposed outside one. It uses
`submit: false`, so it sends nothing.
