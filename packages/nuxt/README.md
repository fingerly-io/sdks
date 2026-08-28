# @badele/nuxt

The Badele SDK as a Nuxt module. It wraps [`@badele/vue`](../vue/README.md) and
adds the three things that are about Nuxt: where the configuration comes from,
who installs the plugin, and auto-imported composables.

Requires Nuxt **3 or newer**. Tested against Nuxt 4.

```
pnpm add @badele/nuxt
```

## Add the module

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@badele/nuxt'],
  badele: {
    apiKey: 'pk_live_…',
  },
})
```

Or leave the key out of the config and set it in the environment:

```
NUXT_PUBLIC_BADELE_API_KEY=pk_live_…
```

The environment wins, and that is the point. Nuxt reads `runtimeConfig.public`
when the server **starts**, not when the bundle is built, so one build can be
promoted through staging and production with a different key in each. A module
that baked its config option into the bundle would take that away, so the
option is a default and the runtime config overrides it.

The key is a **public** SDK key, scoped to the origins you list against it,
which is what makes it safe in a page. A **secret** key is refused by the API
whenever a request carries an `Origin`.

The module also publishes `badele.endpoint` and `badele.submit`, overridable
the same way with `NUXT_PUBLIC_BADELE_ENDPOINT` and `NUXT_PUBLIC_BADELE_SUBMIT`.

## Use it

The composables are auto-imported, like every other Nuxt composable:

```vue
<script setup lang="ts">
const { verdicts, isSuspicious, isReady } = useIdentify({ immediate: true })
const { matched, reasons } = useVerdict('incognito')
</script>

<template>
  <p v-if="isReady && isSuspicious">Something about this session is unusual.</p>
</template>
```

`useIdentify` · `useVerdict` · `useBadele` — the same three from `@badele/vue`,
unchanged. Their full surface is in that
[package's README](../vue/README.md): `immediate`, `refresh`, a correlation
`tag`, confidence floors, `isSuspicious`.

## What happens on the server

The plugin is universal rather than client-only, which is deliberate:
installing it collects nothing. It makes the client reachable and no more, so a
page can call `useIdentify()` in `setup()` during the server render, render its
"not yet identified" state, and collect after hydration — `immediate` runs in
`onMounted`, which SSR never reaches.

A client-only plugin would instead make the composable throw during the server
render Nuxt does first, which is the failure this arrangement exists to avoid.

Calling `identify()` directly on the server rejects with `BadeleServerError`
and a message saying what to do instead.

## A missing key is a runtime problem, not a build one

Because the key can legitimately arrive from the environment after the build,
the module cannot fail the build over an empty one. The plugin warns instead,
naming the variable, and installs anyway:

```
[badele] No SDK key. Set NUXT_PUBLIC_BADELE_API_KEY in the environment, or
badele.apiKey in nuxt.config.ts. Identification will fail until one is set.
```

Installing anyway is the point. Throwing would take an app down over a fraud
signal, and installing nothing would be worse than that — every
`useIdentify()` in the app would then fail with "no plugin found", pointing at
wiring that is in fact correct. This way the app renders, the composables work,
and `identify()` is what fails, with the SDK's own message about a missing key,
at the moment somebody is looking for it.

## The playground

`playground/` is a real Nuxt app with the module loaded from `src/`:

```
pnpm --filter @badele/nuxt playground
```

Open it twice — an ordinary window and a private one — and watch the incognito
verdict change. That pair is the only real test that verdict gets.
