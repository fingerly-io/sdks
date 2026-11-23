<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly for Nuxt</b><br>The Vue binding as a Nuxt module: runtime configuration, a universal plugin and auto-imported composables.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fingerly/nuxt"><img src="https://img.shields.io/npm/v/@fingerly/nuxt?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@fingerly/nuxt"><img src="https://img.shields.io/npm/dm/@fingerly/nuxt?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/fingerly-io/sdks/blob/main/client/web/nuxt/LICENSE"><img src="https://img.shields.io/npm/l/@fingerly/nuxt?style=flat-square" alt="Apache-2.0 licence"></a>
  <img src="https://img.shields.io/badge/nuxt-3%2B-blue?style=flat-square" alt="Nuxt 3 or newer">
</p>

<p align="center"><img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/banner.webp" alt="Fingerly" width="100%"></p>

## What is this

`@fingerly/nuxt` is the Fingerly SDK as a Nuxt module. It wraps
[`@fingerly/vue`](https://www.npmjs.com/package/@fingerly/vue) and adds the three
things that are about Nuxt: where the configuration comes from, who installs the
plugin, and auto-imported composables. [Fingerly](https://fingerly.io) helps you
protect signups, logins and payments from fraud and abuse.

> **Not for apps.** This binding runs the browser SDK, which collects nothing
> that identifies the device inside an app's web view (`WKWebView`, Android
> `WebView`, Capacitor, Cordova, Ionic, React Native WebView, Flutter WebView,
> Electron) and answers there with an empty `visitorId`. Use the Fingerly iOS or
> Android SDK, or the React Native, Flutter or Lynx bridge, in an app; see
> section 3.3 of the
> [privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md).

## Getting started

1. **Get a key.** Create a public SDK key in the dashboard
   ([how keys work](https://docs.fingerly.io/docs/api-keys)).
2. **Install.**

   ```sh
   npm install @fingerly/nuxt
   # or: pnpm add @fingerly/nuxt
   # or: yarn add @fingerly/nuxt
   ```

3. **Add the module.**

   ```ts
   // nuxt.config.ts
   export default defineNuxtConfig({
     modules: ['@fingerly/nuxt'],
     fingerly: {
       apiKey: 'fly_pk_production_…',
     },
   })
   ```

   Consent is not part of this configuration. The client starts `pending` on
   every page load, and your code calls `setConsent('granted')` once the visitor
   has answered; see [Consent](#consent).

4. **Identify, then let your backend decide.** The composables are
   auto-imported, like every other Nuxt composable:

   ```vue
   <script setup lang="ts">
   const route = useRoute()
   const { identify, isLoading } = useIdentify({ tag: () => `checkout:${route.params.orderId}` })
   const challenge = ref(false)

   async function onSubmit() {
     const { requestId } = await identify()

     // The page only forwards the request ID. Your backend reads the event with
     // the secret key and decides; the page acts on that decision.
     const { decision } = await $fetch<{ decision: string }>('/api/checkout', {
       method: 'POST',
       body: { orderId: route.params.orderId, requestId },
     })
     challenge.value = decision === 'challenge'
   }
   </script>

   <template>
     <form @submit.prevent="onSubmit">
       <button :disabled="isLoading">Continue</button>
     </form>
     <StepUp v-if="challenge" />
   </template>
   ```

`identify()` runs one collection pass (a 350 ms budget by default) and submits
once, in a single round trip to `POST /api/v1/ingest`, resolving with the
server's answer: `requestId`, `visitorId`, `identifiable`, and `suspectScore`
and `suspectLevel` unless the key hides them. Each report carries a single-use
freshness ticket held in memory only; when none is held, the ticket request
runs in parallel with collection and never holds up or fails `identify()`.

`visitorId.value` is `""` (and `visitorIsNew.value` is `false`) whenever
`identifiable.value` is `false`, inside an app's web view, or when the server
declines to name a high-risk visitor it has not seen before. To inspect the raw
`SignalReport` locally without submitting anything, call
`(await useFingerly().client()).collect()`.

`useIdentify` and `useFingerly` are the same two from `@fingerly/vue`,
unchanged. Their full surface is in that
[package's README](https://github.com/fingerly-io/sdks/tree/main/client/web/vue#readme):
`immediate`, `refresh`, `incognitoDetection`, a correlation `tag`, and reading
`suspectLevel` and `isSuspicious`, which is `null`, not `false`, when the level
is absent.

## Contents

- [Decide on your backend](#decide-on-your-backend)
- [Configuration and the environment](#configuration-and-the-environment)
- [Consent](#consent)
- [First-party endpoints](#first-party-endpoints)
- [Options](#options)
- [Server rendering](#server-rendering)
- [A missing key](#a-missing-key)
- [More](#more)
- [TypeScript](#typescript)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Help](#help)
- [Licence](#licence)

## Decide on your backend

Whoever controls the page controls every branch in it, so access decisions
(allow, step up, hold, refuse) are made on your backend. The `requestId` the
page sends is untrusted input until your backend has verified it. Read the
event with the secret key and run the checks described in
[server-side verification](https://docs.fingerly.io/docs/server-side-verification):

```ts
// server/api/checkout.post.ts
import { BlockList } from 'node:net'
import { Fingerly, FingerlyAPIError } from '@fingerly/node'
import { getRequestIP, readBody } from 'h3'

const fingerly = new Fingerly({ secretKey: process.env.FINGERLY_SECRET_KEY })
const MAX_AGE_MS = 2 * 60 * 1000

export default defineEventHandler(async (h3) => {
  const { requestId } = await readBody<{ requestId: string }>(h3)
  // From your server session (the order this visitor is paying for), never
  // from the request body.
  const expectedTag = `checkout:${await orderIdFromSession(h3)}`
  const clientIp = getRequestIP(h3) ?? ''
  return { decision: await decide(requestId, expectedTag, clientIp) }
})

async function decide(requestId: string, expectedTag: string, clientIp: string) {
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
only. Never gate an action on them. One event can back more than one decision
inside the recency window; for a flow that must be single use, record the
`requestId` with the outcome and refuse one you have already seen.

## Configuration and the environment

Leave the key out of the config and set it in the environment instead:

```sh
NUXT_PUBLIC_FINGERLY_API_KEY=fly_pk_production_…
```

The environment wins, and that is the point. Nuxt reads `runtimeConfig.public`
when the server **starts**, not when the bundle is built, so one build can be
promoted through staging and production with a different key in each.

The key is a **public** SDK key, scoped to the origins you list against it,
which is what makes it safe in a page. A **secret** key is refused by the API
whenever a request carries an `Origin`.

The module publishes `fingerly.apiKey`, `fingerly.apiVersion`,
`fingerly.endpoints`, `fingerly.fallbackToDefaultEndpoint`,
`fingerly.incognitoDetection`, `fingerly.continuity` and `fingerly.agentDetection`, each overridable at server startup with its
environment variable (see [Options](#options)). There is no consent variable: a
deployment-wide value would apply to every visitor before any of them answered.

## Consent

The client starts `pending` (`denied` behaves the same) on every page load, and
nothing is collected or sent until it is `granted`. `fingerly.consent` in
`nuxt.config.ts` is ignored with a build-time warning, and there is no
environment variable for it: consent is each visitor's answer, so only a
runtime `setConsent()` call, made once the visitor has answered, changes it.

Until it is `granted`, `useIdentify({ immediate: true })` waits, and a manual
`identify()` fails with a `ConsentError`. Set it from wherever your consent tool
reports the answer, and the identification that was waiting runs, once:

```vue
<!-- app.vue, or wherever the consent tool is wired up -->
<script setup lang="ts">
const fingerly = useFingerly()
// then, in the consent tool's callback, once the visitor accepted:
fingerly.setConsent('granted')
</script>
```

Where no consent is required, call `setConsent('granted')` from your own code
(for example in a client-only plugin) rather than from configuration, so the
decision stays visible in the app.

`setConsent()` is also on the client (`await fingerly.client()`), and the current
state is `consent` in `useIdentify()`. The details are in the
[Vue binding's README](https://github.com/fingerly-io/sdks/tree/main/client/web/vue#consent).

Pass `granted` only once you have consent, or know none is required here. See
section 4 of the
[privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md),
[privacy and consent](https://docs.fingerly.io/docs/privacy-and-consent) and
[consent tools](https://docs.fingerly.io/docs/consent-tools).

## First-party endpoints

`endpoints` is the path of your first-party proxy, the one the dashboard
issued. With `@fingerly/node` it is a Nitro route at that path:

```ts
// server/routes/k7x2qm4a.ts
import { Fingerly } from '@fingerly/node'
import { getRequestIP, toWebRequest } from 'h3'

// Built on the first request rather than at import, so the build does not
// need the proxy key.
let proxy: ((request: Request) => Promise<Response>) | undefined
const addresses = new WeakMap<Request, string>()

export default defineEventHandler((event) => {
  proxy ??= Fingerly.createProxy({
    proxyKey: process.env.FINGERLY_PROXY_KEY!,
    clientIp: (request) => addresses.get(request) ?? '',
  })
  const request = toWebRequest(event)
  // The connection's peer address. Pass { xForwardedFor: true } only when the
  // app can be reached through your own load balancer alone.
  addresses.set(request, getRequestIP(event) ?? '')
  return proxy(request)
})
```

```ts
// nuxt.config.ts
fingerly: { endpoints: ['/k7x2qm4a'] },
```

See [proxy integrations](https://docs.fingerly.io/docs/proxy-integrations) and
the [Node SDK](https://docs.fingerly.io/docs/sdks/node), or pick another
language on the [server SDK pages](https://docs.fingerly.io/docs/sdks).

## Options

The `fingerly` block in `nuxt.config.ts`, published at
`runtimeConfig.public.fingerly`:

| Option | Environment variable | Notes |
| --- | --- | --- |
| `apiKey` | `NUXT_PUBLIC_FINGERLY_API_KEY` | A public SDK key. |
| `endpoints` | `NUXT_PUBLIC_FINGERLY_ENDPOINTS` | An array of first-party ingestion paths, such as `['/k7x2qm4a']`. In the environment, a JSON array such as `'["/k7x2qm4a"]'`. |
| `fallbackToDefaultEndpoint` | `NUXT_PUBLIC_FINGERLY_FALLBACK_TO_DEFAULT_ENDPOINT` | Try the Fingerly API only after the custom endpoints fail. Defaults to `false`. |
| `incognitoDetection` | `NUXT_PUBLIC_FINGERLY_INCOGNITO_DETECTION` | `'standard'` (the default) checks for private browsing without writing to the visitor's storage; `'extended'` adds a storage timing check on Chromium browsers, and is required to detect Chrome incognito (Chromium 152 and later). It writes a few megabytes once per page and takes about a second, starting as soon as consent allows. |
| `continuity` | `NUXT_PUBLIC_FINGERLY_CONTINUITY` | `'none'` (the default) keeps nothing in the browser; `'session'` keeps one signed value in `sessionStorage` for the life of the tab, so an identified private window is carried across its reports. |
| `agentDetection` | `NUXT_PUBLIC_FINGERLY_AGENT_DETECTION` | Off by default. `'interaction'` counts how the page is operated once consent is `granted` (clicks by pointer type, key presses, input events by kind and the like, never a coordinate, key, field value or page text), for recognising an assistant that drives the visitor's own browser. The client is built as soon as consent is `granted`, so the counting starts then rather than at the first identification. |
| `apiVersion` | `NUXT_PUBLIC_FINGERLY_API_VERSION` | API route version. Defaults to `v1`. |

Every key is present in the runtime config even when nothing set it, which is
what lets the environment override it, under Nuxt's usual `NUXT_PUBLIC_` naming
for runtime config. The environment wins over the config option.

## Server rendering

The plugin is universal rather than client-only, which is deliberate:
installing it collects nothing. It makes the client reachable and no more, so a
page can call `useIdentify()` in `setup()` during the server render, render its
"not yet identified" state, and collect after hydration. `immediate` runs in
`onMounted`, which SSR never reaches.

Calling `identify()` directly on the server rejects with `FingerlyServerError`
and a message saying what to do instead.

## A missing key

A missing key is a runtime problem, not a build one. Because the key can
legitimately arrive from the environment after the build, the module cannot fail
the build over an empty one. The plugin warns instead, naming the variable, and
installs anyway:

```
[fingerly] No SDK key. Set NUXT_PUBLIC_FINGERLY_API_KEY in the environment, or
fingerly.apiKey in nuxt.config.ts. Identification will fail until one is set.
```

Installing anyway is the point. Throwing would take an app down over a fraud
signal, and installing nothing would be worse than that: every
`useIdentify()` in the app would then fail with "no plugin found", pointing at
wiring that is in fact correct. This way the app renders, the composables work,
and `identify()` is what fails, with the SDK's own message about a missing key,
at the moment somebody is looking for it.

## More

<details>
<summary>The playground</summary>

`playground/` (in the
[repository](https://github.com/fingerly-io/sdks/tree/main/client/web/nuxt)) is
a real Nuxt app with the module loaded from `src/`:

```sh
pnpm --filter @fingerly/nuxt playground
```

It starts `pending` like any page, so it collects nothing until you press
Accept.

</details>

## TypeScript

Types ship with the package. The module exports `ModuleOptions` (the `fingerly`
block) and `FingerlyPublicConfig` (the shape at `runtimeConfig.public.fingerly`),
and augments Nuxt's `PublicRuntimeConfig` with it. The composables carry the
types of `@fingerly/vue`.

## Requirements

Nuxt **3 or newer**. Tested against Nuxt 4. The browser SDK it wraps needs ES2020
with `fetch` and `AbortController`: every current version of Chrome, Edge,
Firefox and Safari. The proxy and backend examples above use `@fingerly/node`,
which you install in the app yourself.

## Documentation

The Nuxt guide is at
[docs.fingerly.io](https://docs.fingerly.io/docs/sdks/nuxt). The Vue binding
underneath is [`@fingerly/vue`](https://www.npmjs.com/package/@fingerly/vue).

## Help

Open an issue on [fingerly-io/sdks](https://github.com/fingerly-io/sdks/issues),
or write to [support@fingerly.io](mailto:support@fingerly.io). Security issues:
[security@fingerly.io](mailto:security@fingerly.io).

## Licence

[Apache-2.0](https://github.com/fingerly-io/sdks/blob/main/client/web/nuxt/LICENSE). Fingerly is a product of Badele LLC.
