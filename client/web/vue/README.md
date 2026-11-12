<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly for Vue</b><br>A plugin, three composables, and one shared result per page.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fingerly/vue"><img src="https://img.shields.io/npm/v/@fingerly/vue?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@fingerly/vue"><img src="https://img.shields.io/npm/dm/@fingerly/vue?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/fingerly-io/sdks/blob/main/client/web/vue/LICENSE"><img src="https://img.shields.io/npm/l/@fingerly/vue?style=flat-square" alt="Apache-2.0 licence"></a>
  <img src="https://img.shields.io/badge/vue-3.3%2B-blue?style=flat-square" alt="Vue 3.3 or newer">
</p>

<p align="center"><img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/banner.webp" alt="Fingerly" width="100%"></p>

## What is this

`@fingerly/vue` is the Vue 3 binding for the Fingerly browser SDK. The plugin
holds one client and one shared result, and the `useIdentify()` composable reads
it, so a checkout, a login form and a risk banner can all ask the same question
and pay for one answer. [Fingerly](https://fingerly.io) helps you protect
signups, logins and payments from fraud and abuse. Using Nuxt? See
[`@fingerly/nuxt`](https://www.npmjs.com/package/@fingerly/nuxt), which wraps
this package.

> **Not for apps.** This binding runs the browser SDK, which collects nothing
> inside an app's web view (Capacitor, Cordova, Ionic, React Native WebView,
> `WKWebView`, Android `WebView`, Electron). Use the Fingerly iOS or Android SDK
> in an app; see section 3.3 of the
> [privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md).

## Getting started

1. **Get a key.** Create a public SDK key in the dashboard
   ([how keys work](https://docs.fingerly.io/docs/api-keys)).
2. **Install.**

   ```sh
   npm install @fingerly/vue
   # or: pnpm add @fingerly/vue
   # or: yarn add @fingerly/vue
   ```

3. **Install the plugin, then identify.**

   ```ts
   // main.ts
   import { createApp } from 'vue'
   import { createFingerly } from '@fingerly/vue'
   import App from './App.vue'

   createApp(App)
     // consent: 'granted' only once you have consent (or know none is required here; see Consent below)
     .use(createFingerly({ apiKey: 'fly_pk_production_…', consent: 'granted' }))
     .mount('#app')
   ```

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

The key is a **public** SDK key from the dashboard, and it belongs in the page:
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

Installing the plugin collects nothing. It makes the client available and
nothing more; when to identify is the page's decision, not the plugin's.

`identify()` collects and submits, and resolves with the server's answer in the
same round trip: the `requestId`, who the visitor is (`visitorId`), and the
`suspectScore` and `suspectLevel`, unless the key hides them. Nothing is decided
in the page: scoring lives on the server, under the weights you set.

## Contents

- [Identify on mount](#identify-on-mount)
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

## Identify on mount

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
`null` when the level is absent: no server has answered yet, the submission went
unscored, or the SDK key hides the score from the page, which cannot tell those
apart. Null is not a clean result.

Signals are read on your backend, by `requestId`, never in the page: which check
tripped is what a fraudster wants to learn. See
[server-side verification](https://docs.fingerly.io/docs/server-side-verification)
and the [server SDKs](https://docs.fingerly.io/docs/sdks).

### A correlation tag

Echoed back on the finished event so you can match a submission to whatever the
page was doing. It accepts a ref or a getter, and is read at submission time
rather than at setup time:

```ts
const route = useRoute()
const { identify } = useIdentify({ tag: () => `checkout:${route.params.orderId}` })
```

## Consent

Consent defaults to `pending`, and nothing is collected or sent until it is
`granted`. A page with a consent banner leaves it `pending` and calls
`setConsent('granted')` once the banner is accepted. If identifying a visitor
needs their consent first, install the plugin with `consent: 'pending'`, the
default: `useIdentify({ immediate: true })` waits, and the client is not even
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

```ts
createFingerly({ apiKey: 'fly_pk_production_…', endpoints: '/k7x2qm4a', consent: 'granted' })
```

The proxy is mounted by a server SDK: see
[proxy integrations](https://docs.fingerly.io/docs/proxy-integrations) and the
[Node SDK](https://docs.fingerly.io/docs/sdks/node), or pick another language on
the [server SDK pages](https://docs.fingerly.io/docs/sdks).

## Options

`createFingerly(options)`:

| Option | Type | Notes |
| --- | --- | --- |
| `apiKey` | `string` | Required. A public SDK key. |
| `endpoints` | `string \| string[]` | Ordered first-party ingestion paths or URLs, compared by contents. |
| `fallbackToDefaultEndpoint` | `boolean` | Try the Fingerly API only after the custom endpoints fail. |
| `consent` | `'pending' \| 'granted' \| 'denied'` | Defaults to `pending`. |
| `submit` | `boolean` | `false` collects without submitting (see below). |
| `apiVersion` | `string` | API route version. Defaults to `v1`. |

`useIdentify()` options: `immediate` and `tag` (a string, a ref or a getter).
`identify()` takes `{ tag, force }` and `refresh()` takes `{ tag }`.

### Collect without submitting

For a debug page that wants the raw report and nothing else:

```ts
app.use(createFingerly({ apiKey: 'fly_pk_production_…', submit: false }))
```

Everything the server decides comes back empty: no `requestId`, no `visitorId`,
`suspectScore` is `null` rather than `0`, and `isSuspicious` is
`null` rather than `false`. That is the honest answer rather than a gap: nothing
was sent, so nobody scored it, and this SDK decides nothing on its own.

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
  suspectScore,      // Ref<number | null>:        null when nothing scored it
  suspectLevel,      // Ref<string | null>:        low, medium, high
  report,            // Ref<SignalReport | null>:  every source, with status and timing
  error,             // Ref<Error | null>
  consent,           // Ref<ConsentState>        (granted, pending or denied)
  isLoading,    // Ref<boolean>
  isReady,      // ComputedRef<boolean>:     finished, successfully or not
  isSuspicious, // ComputedRef<boolean | null>: true for medium or high; null when the level is absent
  identify,     // () => Promise<IdentifyResult>
  refresh,      // () => Promise<IdentifyResult>
} = useIdentify()
```

Every ref is **readonly**. The state is shared, so a component that could assign
to it would be changing what every other component sees.

Weights and signal names never reach the browser: your backend reads them on the
server-side event read.

The detectors run on the server, over the report this package sends, so rules
improve without every integration redeploying. Everything here that says
anything about a visitor came from the server.

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
the client. The error reference is at
[docs.fingerly.io](https://docs.fingerly.io/reference/errors).

## Server rendering

`{ immediate: true }` runs in `onMounted`, so an SSR render (a Nuxt page, for
example) shows the unidentified state and the browser collects after hydration.
Calling `identify()` directly during the server render rejects with
`FingerlyServerError`, as above.

## More

### Options API

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

### The visitor is never asked for anything

No permission prompt, no picker, no dialog, on any browser. Reading a
permission's *state* prompts nobody and is used freely; requesting is banned
outright and enforced by a test in `@fingerly/web-js`. The one browser API that
can prompt (Tor Browser answers it with a doorhanger) is skipped whenever the
SDK detects that browser would prompt.

You can drop this into a checkout without it ever interrupting the checkout.

<details>
<summary>Running the demo</summary>

`demo/` (in the
[repository](https://github.com/fingerly-io/sdks/tree/main/client/web/vue)) is
this package's composables driving the real SDK (no mocks) with
`useIdentify({ immediate: true })` in the root, showing `suspectScore` and
`suspectLevel` beside the raw report, all sharing one identification.

```sh
pnpm --filter @fingerly/vue demo   # http://localhost:4174
```

That bundles `demo/main.ts` (the binding, the SDK and Vue's runtime in one
file, because `demo/index.html` is a plain `<script>` tag) and serves it.

It is served rather than opened from disk because some collection needs a
secure context and `file://` is not one. It uses `submit: false`, so it
sends nothing and no server answers: the raw report fills in, and the score
and level read hidden.

</details>

## TypeScript

Types ship with the package. `FingerlyVueOptions`, `FingerlyContext`,
`FingerlyState`, `ReadonlyState`, `UseIdentifyOptions` and `UseIdentifyReturn`
are exported, together with the types you receive (`IdentifyResult`,
`ConsentState`, `SignalReport`, `SignalOutcome`, `SignalStatus`,
`IntegrityReport`, `Lie`, `Confidence` and `FingerlyWebEvent`). `this.$fingerly`
is typed on Vue's component properties. The values `ConsentError`,
`TransportError`, `FingerlyServerError` and `fingerlyKey` (the injection key) are
exported too. The package is side-effect free.

## Requirements

Vue **3.3 or newer** (it uses `hasInjectionContext`, `toValue` and
`MaybeRefOrGetter`). Tested against 3.5. The browser SDK it wraps needs ES2020
with `fetch` and `AbortController`: every current version of Chrome, Edge,
Firefox and Safari.

## Documentation

The Vue guide is at
[docs.fingerly.io](https://docs.fingerly.io/docs/sdks/vue). The browser SDK
underneath is [`@fingerly/web-js`](https://www.npmjs.com/package/@fingerly/web-js).

## Help

Open an issue on [fingerly-io/sdks](https://github.com/fingerly-io/sdks/issues),
or write to [support@fingerly.io](mailto:support@fingerly.io). Security issues:
[security@fingerly.io](mailto:security@fingerly.io).

## Licence

[Apache-2.0](https://github.com/fingerly-io/sdks/blob/main/client/web/vue/LICENSE). Fingerly is a product of Badele LLC.
