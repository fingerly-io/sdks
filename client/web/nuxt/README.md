# @fingerly/nuxt

The Fingerly SDK as a Nuxt module. It wraps [`@fingerly/vue`](../vue/README.md) and
adds the three things that are about Nuxt: where the configuration comes from,
who installs the plugin, and auto-imported composables.

Requires Nuxt **3 or newer**. Tested against Nuxt 4.

```
pnpm add @fingerly/nuxt
```

## Add the module

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@fingerly/nuxt'],
  fingerly: {
    apiKey: 'fly_pk_production_…',
    // 'granted' only once you have consent (or another lawful basis)
    consent: 'granted',
  },
})
```

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

### Serve it from your own site

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

### Waiting for consent

Consent defaults to `pending` (`denied` behaves the same). If identifying a
visitor needs their consent first, leave it `pending`:

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
[Vue binding's README](../vue/README.md#waiting-for-consent).

## Use it

The composables are auto-imported, like every other Nuxt composable:

```vue
<script setup lang="ts">
const { suspectLevel, isSuspicious, isReady } = useIdentify({ immediate: true })
</script>

<template>
  <p v-if="isReady && isSuspicious">Something about this session is unusual.</p>
</template>
```

`useIdentify` · `useFingerly`: the same two from `@fingerly/vue`,
unchanged. Their full surface is in that
[package's README](../vue/README.md): `immediate`, `refresh`, a correlation
`tag`, and reading `suspectLevel` and `isSuspicious`, which is `null`, not `false`, when the level is absent.

## What happens on the server

The plugin is universal rather than client-only, which is deliberate:
installing it collects nothing. It makes the client reachable and no more, so a
page can call `useIdentify()` in `setup()` during the server render, render its
"not yet identified" state, and collect after hydration. `immediate` runs in
`onMounted`, which SSR never reaches.

A client-only plugin would instead make the composable throw during the server
render Nuxt does first, which is the failure this arrangement exists to avoid.

Calling `identify()` directly on the server rejects with `FingerlyServerError`
and a message saying what to do instead.

## A missing key is a runtime problem, not a build one

Because the key can legitimately arrive from the environment after the build,
the module cannot fail the build over an empty one. The plugin warns instead,
naming the variable, and installs anyway:

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

## The playground

`playground/` is a real Nuxt app with the module loaded from `src/`:

```
pnpm --filter @fingerly/nuxt playground
```

It uses `submit: false`, so it sends nothing and no server answers: the raw
report fills in, and the score and level read hidden.
