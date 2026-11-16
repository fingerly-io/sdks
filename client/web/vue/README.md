# @fingerly/vue

Vue 3 bindings for the Fingerly SDK (`0.3.0`, single-pass `v: 3`). A plugin, two
composables (`useIdentify` and `useFingerly`), and one shared `1-RTT` result per
page.

Requires Vue **3.3 or newer** (it uses `hasInjectionContext`, `toValue` and
`MaybeRefOrGetter`). Tested against 3.5.

```sh
pnpm add @fingerly/vue@^0.3.0
```

**Not for apps.** This binding runs `@fingerly/web-js`, which skips all
device-fingerprinting collectors inside embedded app WebViews (`WKWebView`,
Android `WebView`, Capacitor, Cordova, Ionic, React Native WebView, Flutter
WebView, Electron) to preserve Apple DPLA §3.3.3(B) compliance, running only the
non-identifying `EMBEDDED_SAFE_SOURCES` subset and returning `visitorId: ""`
under Option B. Use the native Fingerly iOS or Android SDK (or the React Native,
Flutter, or Lynx bridge) in an app; see [docs/privacy.md §3.3](../../../docs/privacy.md).

## Install the plugin

```ts
// main.ts
import { createApp } from 'vue'
import { createFingerly } from '@fingerly/vue'
import App from './App.vue'

createApp(App)
  // consent: 'granted' only once you have consent (or know none is required here; see docs/privacy.md §4)
  .use(
    createFingerly({
      apiKey: 'fly_pk_production_…',
      consent: 'granted',
      incognitoDetection: 'standard',
    }),
  )
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

## Identify (single-pass `v: 3`, `<= 350 ms` budget)

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

`identify()` runs a single-pass browser collection (`<= 350 ms` default budget,
including the Stage 1 Gecko `<= 3 ms` RFP timer guard and CSP-safe
`worker_realm` check) and submits once in **1 RTT** to `POST /api/v1/ingest`,
resolving with the server's answer: `requestId`, `visitorId`, `identifiable`,
and `suspectScore` / `suspectLevel` (unless hidden by the key). Nothing is
decided in the page: scoring lives on the server, under the weights you set.

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

### Incognito detection (`'standard' | 'extended'`)

Pass `incognitoDetection` on `createFingerly()`, `useIdentify()` (accepts a ref
or getter), or `identify()` / `refresh()`: `'standard'` (default) runs
zero-write probes, while `'extended'` opts into Chromium IndexedDB
`storage_durability` timing within the single-pass budget.

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

## Reading the answer & Option B

`suspectLevel` is the server's band for this submission, under the weights you
set. `isSuspicious` is `true` for `medium` or `high`, `false` for `low`, and
`null` when the level is absent: no server has answered yet, the submission went
unscored, or the SDK key hides the score from the page. Null is not a clean
result.

Under **Option B** (`v: 3`), `visitorId.value` is `null` before the first
identification completes, and afterwards holds `result.visitorId` — which is
`""` (with `visitorIsNew.value === false`) whenever `identifiable.value === false`,
inside an embedded WebView, or when an unmatched Web report is high-risk.

Signals are read on your backend, by `requestId`, never in the page: which check
tripped is what a fraudster wants to learn.

## A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It accepts a ref or a getter, and is read at submission time
rather than at setup time:

```ts
const route = useRoute()
const { identify } = useIdentify({ tag: () => `checkout:${route.params.orderId}` })
```

## Local collection without submitting (`collect()`)

For a debug page that wants to inspect the raw `SignalReport` locally without
posting to `/api/v1/ingest`, call `collect()` on the underlying client:

```ts
const fingerly = useFingerly()
const client = await fingerly.client()
const report = await client.collect()
```

`collect()` still requires `consent === 'granted'` and rejects with
`ConsentError` otherwise.

## Waiting for consent

If identifying a visitor needs their consent first, install the plugin with
`consent: 'pending'`, the default. Until it is `granted` nothing is collected
and nothing is sent: `useIdentify({ immediate: true })` waits, and the client is
not even built.

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

Not every Vue 3 component is `<script setup>`. The context is on
`this.$fingerly`:

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
  requestId,         // Readonly<ShallowRef<string | null>>:  identifies this submission
  visitorId,         // Readonly<ShallowRef<string | null>>:  null before completion; "" when identifiable === false (Option B)
  visitorIsNew,      // Readonly<ShallowRef<boolean>>:        true only when a new visitor was minted
  visitorConfidence, // Readonly<ShallowRef<number>>:         0 to 100
  identifiable,      // Readonly<ShallowRef<boolean>>:        false when the signals were too thin
  duplicate,         // Readonly<ShallowRef<boolean>>:        answered before; this is the cached answer
  state,             // Readonly<ShallowRef<string | null>>:  the server's disposition
  suspectScore,      // Readonly<ShallowRef<number | null>>:  null when unscored or hidden by the key
  suspectLevel,      // Readonly<ShallowRef<SuspectLevel | null>>: low, medium, high
  report,            // Readonly<ShallowRef<SignalReport | null>>: every source, with status and timing
  error,             // Readonly<ShallowRef<Error | null>>
  consent,           // Readonly<ShallowRef<ConsentState>>    (granted, pending or denied)
  isLoading,         // Readonly<Ref<boolean>>
  isReady,           // ComputedRef<boolean>:                 finished, successfully or not
  isSuspicious,      // ComputedRef<boolean | null>:          true for medium or high; null when absent
  identify,          // (opts?) => Promise<IdentifyResult>
  refresh,           // (opts?) => Promise<IdentifyResult>
} = useIdentify()
```

Every ref is **readonly**. The state is shared, so a component that could assign
to it would be changing what every other component sees.

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
pnpm --filter @fingerly/vue demo   # http://localhost:4174
```

Serve it over `localhost` rather than opening from `file://`, as storage and
worker probes require a secure context.
