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
  // consent: 'granted' only once you have consent (or another lawful basis)
  .use(createFingerly({ apiKey: 'fly_pk_production_…', consent: 'granted' }))
  .mount('#app')
```

The key is a **public** SDK key from the dashboard, and it belongs in the page:
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

Installing the plugin collects nothing. It makes the client available and
nothing more; when to identify is the page's decision, not the plugin's.

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
createFingerly({ apiKey: 'fly_pk_production_…', endpoints: '/k7x2qm4a', consent: 'granted' })
```

## Identify

```vue
<script setup lang="ts">
import { useIdentify } from '@fingerly/vue'

const { identify, isSuspicious, isLoading, error } = useIdentify()

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

`identify()` collects and submits, and resolves with the server's answer in the
same round trip: the `requestId`, who the visitor is (`visitorId`), and the
`suspectScore`, `suspectLevel` and triggers behind it. Nothing is decided in the
page: scoring lives on the server, under the weights you set.

### On mount instead

```vue
<script setup lang="ts">
const { suspectLevel, isReady } = useIdentify({ immediate: true })
</script>
```

`immediate` runs in `onMounted`, which is what makes it **safe under SSR**: the
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
// All three of Header.vue, CheckoutForm.vue, RiskBanner.vue:
const { suspectLevel } = useIdentify({ immediate: true })
// → one network request, one shared answer
```

To deliberately identify again (a long-lived SPA reaching a second checkout):

```ts
const { refresh } = useIdentify()
await refresh() // ignores the cached result and collects afresh
```

## Reading the answer

`suspectLevel` is the server's band for this submission, under the weights you
set. `isSuspicious` is `true` for `medium` or `high`, `false` for `low`, and
`null` when no server has answered yet or the submission went unscored.
`triggers` lists what fired:

```vue
<script setup lang="ts">
const { suspectLevel, triggers } = useIdentify()
</script>

<template>
  <aside v-if="suspectLevel === 'high'">
    Unusual session
    <ul><li v-for="t in triggers" :key="t.signal">{{ t.signal }} ({{ t.confidence }})</li></ul>
  </aside>
</template>
```

`useVerdict()` and `verdicts` are **deprecated** and warn once in development.
They are derived from `triggers` for one transition version and hold nothing
rather than all clear when no server answered, so read `suspectLevel` and
`triggers` instead.

## A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It accepts a ref or a getter, and is read at submission time
rather than at setup time:

```ts
const route = useRoute()
const { identify } = useIdentify({ tag: () => `checkout:${route.params.orderId}` })
```

## Collect without submitting

For a debug page that wants the raw report and nothing else:

```ts
app.use(createFingerly({ apiKey: 'fly_pk_production_…', submit: false }))
```

Everything the server decides comes back empty: no `requestId`, no `visitorId`,
`suspectScore` is `null` rather than `0`, and `isSuspicious` and `matched` are
`null` rather than `false`. That is the honest answer rather than a gap: nothing
was sent, so nobody scored it, and this SDK decides nothing on its own.

## Waiting for consent

If identifying a visitor needs their consent first, install the plugin with
`consent: 'pending'`, the default. Until it is `granted` nothing is collected and nothing is
sent: `useIdentify({ immediate: true })` waits, and the client is not even
built.

```ts
app.use(createFingerly({ apiKey: 'fly_pk_production_…', consent: 'pending' }))
```

Then set it from wherever your consent tool reports the answer:

```ts
const fingerly = useFingerly()             // or this.$fingerly
fingerly.setConsent('granted')             // from the consent tool's callback

const client = await fingerly.client()
client.setConsent('denied')                // the same, on the client itself
```

- `consent`: `'pending'` (the default), `'granted'` or `'denied'`, an option to
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
    const { suspectLevel } = await this.$fingerly.identify()
    this.suspicious = suspectLevel === 'high'
  },
}
</script>
```

## What you get back

```ts
const {
  requestId,         // Ref<string | null>:        identifies this submission
  visitorId,         // Ref<string | null>:        who the server decided this is
  visitorIsNew,      // Ref<boolean>:              never seen before
  visitorConfidence, // Ref<number>:               0 to 100
  identifiable,      // Ref<boolean>:              false when the signals were too thin
  duplicate,         // Ref<boolean>:              answered before; this is the first answer
  state,             // Ref<string | null>:        the server's disposition
  reason,            // Ref<string | null>:        always null (deprecated); your backend reads it on the event
  suspectScore,      // Ref<number | null>:        null when nothing scored it
  suspectLevel,      // Ref<string | null>:        low, medium, high
  triggers,          // Ref<IdentifyTrigger[]>:    what the server scored on (signal, group, confidence, reason)
  verdicts,          // Ref<Verdicts | null>:      deprecated; derived from triggers
  report,            // Ref<SignalReport | null>:  every source, with status and timing
  error,             // Ref<Error | null>
  consent,           // Ref<ConsentState>        (granted, pending or denied)
  isLoading,    // Ref<boolean>
  isReady,      // ComputedRef<boolean>:     finished, successfully or not
  isSuspicious, // ComputedRef<boolean | null>: true for medium or high; null when no server answered
  identify,     // () => Promise<IdentifyResult>
  refresh,      // () => Promise<IdentifyResult>
} = useIdentify()
```

Every ref is **readonly**. The state is shared, so a component that could assign
to it would be changing what every other component sees.

A trigger's `reason` is why it fired, strongest first, because a score that
cannot say why it is high is not something you can defend to a customer whose
user you blocked. Weights never reach the browser: a `triggers` entry names the
signal, its group, confidence and reason, and your backend reads the rest on the
server-side event read.

The detectors run on the server, over the report this package sends, so rules
improve without every integration redeploying. Everything here that says
anything about a visitor came from the server.

## The visitor is never asked for anything

No permission prompt, no picker, no dialog, on any browser. Reading a
permission's *state* prompts nobody and is used freely; requesting is banned
outright and enforced by a test in `@fingerly/web-js`. The one API that prompts on
some browsers (canvas readback, which raises a doorhanger in Tor Browser) is
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

`demo/` is this package's composables driving the real SDK (no mocks) with
`useIdentify({ immediate: true })` in the root, showing `suspectScore`,
`suspectLevel` and `triggers` beside the raw report, all sharing one
identification.

```
pnpm --filter @fingerly/vue demo   # http://localhost:4174
```

That bundles `demo/main.ts` (the binding, the SDK and Vue's runtime in one
file, because `demo/index.html` is a plain `<script>` tag) and serves it.

It is served rather than opened from disk because several sources need a
secure context and `file://` is not one; the storage probes are the clearest
case, since they are not exposed outside one. It uses `submit: false`, so it
sends nothing and no server answers: the raw report fills in, and the score,
level and triggers stay empty.
