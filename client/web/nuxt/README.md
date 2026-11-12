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
> inside an app's web view (Capacitor, Cordova, Ionic, React Native WebView,
> `WKWebView`, Android `WebView`, Electron). Use the Fingerly iOS or Android SDK
> in an app; see section 3.3 of the
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

3. **Add the module, then identify.**

   ```ts
   // nuxt.config.ts
   export default defineNuxtConfig({
     modules: ['@fingerly/nuxt'],
     fingerly: {
       apiKey: 'fly_pk_production_…',
       // 'granted' only once you have consent (or know none is required here; see Consent below)
       consent: 'granted',
     },
   })
   ```

   The composables are auto-imported, like every other Nuxt composable:

   ```vue
   <script setup lang="ts">
   const { suspectLevel, isSuspicious, isReady } = useIdentify({ immediate: true })
   </script>

   <template>
     <p v-if="isReady && isSuspicious">Something about this session is unusual.</p>
   </template>
   ```

`useIdentify` and `useFingerly` are the same two from `@fingerly/vue`,
unchanged. Their full surface is in that
[package's README](https://github.com/fingerly-io/sdks/tree/main/client/web/vue#readme):
`immediate`, `refresh`, a correlation `tag`, and reading `suspectLevel` and
`isSuspicious`, which is `null`, not `false`, when the level is absent.

## Contents

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

## Configuration and the environment

Or leave the key out of the config and set it in the environment:

```
NUXT_PUBLIC_FINGERLY_API_KEY=fly_pk_production_…
```

The environment wins, and that is the point. Nuxt reads `runtimeConfig.public`
when the server **starts**, not when the bundle is built, so one build can be
promoted through staging and production with a different key in each. A module
that baked its config option into the bundle would take that away, so the
option is a default and the runtime config overrides it.

The key is a **public** SDK key, scoped to the origins you list against it,
which is what makes it safe in a page. A **secret** key is refused by the API
whenever a request carries an `Origin`.

The module also publishes `fingerly.endpoints`, `fingerly.submit` and
`fingerly.consent`, overridable the same way with
`NUXT_PUBLIC_FINGERLY_ENDPOINTS` (a JSON array, such as `'["/k7x2qm4a"]'`),
`NUXT_PUBLIC_FINGERLY_SUBMIT` and `NUXT_PUBLIC_FINGERLY_CONSENT`.

## Consent

Consent defaults to `pending` (`denied` behaves the same), and nothing is
collected or sent until it is `granted`. If identifying a visitor needs their
consent first, leave it `pending`:

```ts
// nuxt.config.ts
fingerly: {
  apiKey: 'fly_pk_production_…',
  consent: 'pending',
},
```

Until it is `granted` nothing is collected and nothing is sent:
`useIdentify({ immediate: true })` waits, and a manual `identify()` fails with a
`ConsentError`. Set it from wherever your consent tool reports the answer, and
the identification that was waiting runs, once:

```vue
<!-- app.vue, or wherever the consent tool is wired up -->
<script setup lang="ts">
const fingerly = useFingerly()
// then, in the consent tool's callback:
fingerly.setConsent('granted')
</script>
```

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
fingerly: { endpoints: ['/k7x2qm4a'], consent: 'granted' },
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
| `endpoints` | `NUXT_PUBLIC_FINGERLY_ENDPOINTS` | An array of first-party ingestion paths, such as `['/k7x2qm4a']`. In the environment, a JSON array. |
| `fallbackToDefaultEndpoint` | | Try the Fingerly API only after the custom endpoints fail. Defaults to `false`. |
| `consent` | `NUXT_PUBLIC_FINGERLY_CONSENT` | `'pending'` (the default), `'granted'` or `'denied'`. |
| `submit` | `NUXT_PUBLIC_FINGERLY_SUBMIT` | `false` collects without submitting. Defaults to `true`. |
| `apiVersion` | | API route version. Defaults to `v1`. |

Every key is present in the runtime config even when nothing set it, which is
what lets the environment override it, under Nuxt's usual `NUXT_PUBLIC_` naming
for runtime config. The environment wins over the config option.

## Server rendering

The plugin is universal rather than client-only, which is deliberate:
installing it collects nothing. It makes the client reachable and no more, so a
page can call `useIdentify()` in `setup()` during the server render, render its
"not yet identified" state, and collect after hydration. `immediate` runs in
`onMounted`, which SSR never reaches.

A client-only plugin would instead make the composable throw during the server
render Nuxt does first, which is the failure this arrangement exists to avoid.

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

It uses `submit: false`, so it sends nothing and no server answers: the raw
report fills in, and the score and level read hidden.

</details>

## TypeScript

Types ship with the package. The module exports `ModuleOptions` (the `fingerly`
block) and `FingerlyPublicConfig` (the shape at `runtimeConfig.public.fingerly`),
and augments Nuxt's `PublicRuntimeConfig` with it. The composables carry the
types of `@fingerly/vue`.

## Requirements

Nuxt **3 or newer**. Tested against Nuxt 4. The browser SDK it wraps needs ES2020
with `fetch` and `AbortController`: every current version of Chrome, Edge,
Firefox and Safari.

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
