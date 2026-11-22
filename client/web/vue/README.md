<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly for Vue</b><br>A plugin, two composables, and one shared result per page.</p>

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
it (`useFingerly()` reaches the context and the client underneath), so a
checkout, a login form and a risk banner can all ask the same question and pay
for one answer. [Fingerly](https://fingerly.io) helps you protect signups,
logins and payments from fraud and abuse. Using Nuxt? See
[`@fingerly/nuxt`](https://www.npmjs.com/package/@fingerly/nuxt), which wraps
this package.

> **Not for apps.** This binding runs the browser SDK, which collects no
> device-identifying signals inside an app's web view (Capacitor, Cordova,
> Ionic, React Native WebView, Flutter WebView, `WKWebView`, Android `WebView`,
> Electron), so the server answers there with an empty `visitorId`. This keeps
> apps within section 3.3.3(B) of Apple's developer licence. Use the Fingerly
> iOS or Android SDK, or the React Native, Flutter or Lynx bridge, in an app;
> see section 3.3 of the
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
   import { ref } from 'vue'
   import { useIdentify } from '@fingerly/vue'

   const props = defineProps<{ orderId: string }>()
   const { identify, isLoading, error } = useIdentify({ tag: () => `checkout:${props.orderId}` })
   const challenge = ref(false)

   async function onSubmit() {
     const { requestId } = await identify()

     // The page only forwards the request ID. Your backend reads the event with
     // the secret key and decides; the page acts on that decision.
     const response = await fetch('/api/checkout', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ orderId: props.orderId, requestId }),
     })
     const { decision } = await response.json()
     challenge.value = decision === 'challenge'
   }
   </script>

   <template>
     <form @submit.prevent="onSubmit">
       <button :disabled="isLoading">
         {{ isLoading ? 'Checking…' : 'Continue' }}
       </button>
     </form>
     <StepUp v-if="challenge" />
     <p v-if="error">{{ error.message }}</p>
   </template>
   ```

4. **Decide on your backend.** Read the event by `requestId` with the secret
   key; see [Decide on your backend](#decide-on-your-backend).

The key is a **public** SDK key from the dashboard, and it belongs in the page:
it is scoped to the origins you list, which is what makes it safe there. A
**secret** key is refused if it arrives with an `Origin`, so pasting one here
does not work by design.

Installing the plugin collects nothing. It makes the client available and
nothing more; when to identify is the page's decision, not the plugin's.

`identify()` collects in a single pass (within a 350 ms budget by default) and
submits once to `POST /api/v1/ingest`, resolving in the same round trip with
the server's answer: the `requestId`, who the visitor is (`visitorId`), whether
they could be identified (`identifiable`), and the `suspectScore` and
`suspectLevel`, unless the key hides them. Nothing is decided in the page:
scoring lives on the server, under the weights you set. Each report carries a
single-use freshness ticket, held in memory only; when none is held, the ticket
request runs in parallel with collection and never holds up or fails
`identify()`.

## Contents

- [Decide on your backend](#decide-on-your-backend)
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

## Decide on your backend

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
unscored, or the SDK key hides the score from the page. Null is not a clean
result.

`visitorId.value` is `null` before the first identification completes.
Afterwards it holds the server's answer, which is `""` (with
`visitorIsNew.value` `false`) whenever `identifiable.value` is `false`, inside
an app's web view, or when an unmatched browser report is high risk.

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
`granted`. If identifying a visitor needs their consent first, install the
plugin with `consent: 'pending'`, the default, and call `setConsent('granted')`
once your consent banner is accepted: until then `useIdentify({ immediate: true })`
waits, and the client is not even built.

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
| `incognitoDetection` | `'standard' \| 'extended'` | Defaults to `standard` (see below). |
| `continuity` | `'none' \| 'session'` | Defaults to `none`, which keeps nothing in the browser; `session` keeps one signed value in `sessionStorage` for the life of the tab, so an identified private window is carried across its reports. |
| `agentDetection` | `'interaction'` | Off by default. `'interaction'` counts how the page is operated once consent is `granted` (clicks by pointer type, key presses, input events by kind and the like, never a coordinate, key, field value or page text), for recognising an assistant that drives the visitor's own browser. The client is built as soon as consent is `granted`, so the counting starts then rather than at the first identification. |
| `apiVersion` | `string` | API route version. Defaults to `v1`. |

`useIdentify()` options: `immediate`, `tag` and `incognitoDetection` (each of
the last two a value, a ref or a getter). `identify()` takes
`{ tag, incognitoDetection, force }` and `refresh()` takes
`{ tag, incognitoDetection }`.

### Incognito detection

`incognitoDetection` is accepted on `createFingerly()`, `useIdentify()`, and
`identify()` / `refresh()`, the narrowest one winning. `'standard'` (the
default) never writes to the visitor's storage; `'extended'` opts into an
additional storage timing check on Chromium browsers, inside the same
collection budget.

### Collect without submitting

For a debug page that wants to inspect the raw `SignalReport` locally without
posting it to `/api/v1/ingest`, call `collect()` on the underlying client:

```ts
const fingerly = useFingerly()
const client = await fingerly.client()
const report = await client.collect()
```

Nothing is sent, so nothing is scored and nothing in `useIdentify()` changes.
`collect()` still requires consent to be `granted` and rejects with a
`ConsentError` otherwise.

## What you get back

```ts
const {
  requestId,         // Readonly<ShallowRef<string | null>>:  identifies this submission
  visitorId,         // Readonly<ShallowRef<string | null>>:  null before completion; "" when identifiable === false
  visitorIsNew,      // Readonly<ShallowRef<boolean>>:        true only when a new visitor was minted
  visitorConfidence, // Readonly<ShallowRef<number>>:         0 to 100
  identifiable,      // Readonly<ShallowRef<boolean>>:        false when the signals were too thin
  duplicate,         // Readonly<ShallowRef<boolean>>:        answered before; this is the cached answer
  state,             // Readonly<ShallowRef<string | null>>:  the server's disposition
  suspectScore,      // Readonly<ShallowRef<number | null>>:  null when unscored or hidden by the key
  suspectLevel,      // Readonly<ShallowRef<SuspectLevel | null>>: low, medium, high
  identified,        // Readonly<ShallowRef<boolean>>:        an identification has succeeded
  error,             // Readonly<ShallowRef<Error | null>>
  consent,           // Readonly<ShallowRef<ConsentState>>    (granted, pending or denied)
  isLoading,         // Readonly<Ref<boolean>>
  isReady,           // ComputedRef<boolean>:                 finished, successfully or not
  isSuspicious,      // ComputedRef<boolean | null>:          UI hint only; true for medium or high, null when absent
  identify,          // (opts?) => Promise<IdentifyAnswer>
  refresh,           // (opts?) => Promise<IdentifyAnswer>
} = useIdentify()
```

Every ref is **readonly**. The state is shared, so a component that could assign
to it would be changing what every other component sees.

The plugin never keeps the signal report: `identify()` resolves with the
server's answer (`IdentifyAnswer`, the result without `report`), and nothing of
the report stays in app state. Use `collect()`
([Collect without submitting](#collect-without-submitting)) to inspect one.

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
  data: () => ({ requestId: null as string | null }),
  async mounted() {
    // Forward this with the form; your backend verifies it and decides.
    const { requestId } = await this.$fingerly.identify()
    this.requestId = requestId
  },
}
</script>
```

### The visitor is never asked for anything

No permission prompt, no picker, no dialog, on any browser. Reading a
permission's *state* prompts nobody and is used freely; requesting is banned
outright and enforced by a test in `@fingerly/web-js`. The one browser API that
can prompt (Tor Browser, and Firefox with fingerprinting resistance on, answer
it with a doorhanger) is skipped whenever the SDK detects that browser would
prompt.

You can drop this into a checkout without it ever interrupting the checkout.

<details>
<summary>Running the demo</summary>

`demo/` (in the
[repository](https://github.com/fingerly-io/sdks/tree/main/client/web/vue)) is
this package's composables driving the real SDK (no mocks) with
`useIdentify({ immediate: true })` in the root, showing `suspectScore` and
`suspectLevel`, all sharing one identification.

```sh
pnpm --filter @fingerly/vue demo   # http://localhost:4174
```

That bundles `demo/main.ts` (the binding, the SDK and Vue's runtime in one
file, because `demo/index.html` is a plain `<script>` tag) and serves it.

Serve it over `localhost` rather than opening it from `file://`: some
collection needs a secure context, and `file://` is not one.

</details>

## TypeScript

Types ship with the package. `FingerlyVueOptions`, `FingerlyContext`,
`FingerlyState`, `ReadonlyState`, `IdentifyAnswer`, `UseIdentifyOptions` and
`UseIdentifyReturn` are exported, together with the types you receive and pass
(`IdentifyResult`, `IdentifyOptions`, `CollectOptions`, `ConsentState`,
`IncognitoDetection`, `AgentDetection`, `SuspectLevel`, `SignalReport`, `SignalOutcome`,
`SignalStatus`, `IntegrityReport`, `Lie` and `Confidence`). `this.$fingerly`
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
