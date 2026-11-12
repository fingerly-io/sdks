<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly for the browser</b><br>Recognise returning visitors and spot automation, tampering and abuse, with one call from the page.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fingerly/web-js"><img src="https://img.shields.io/npm/v/@fingerly/web-js?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@fingerly/web-js"><img src="https://img.shields.io/npm/dm/@fingerly/web-js?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/fingerly-io/sdks/blob/main/client/web/web-js/LICENSE"><img src="https://img.shields.io/npm/l/@fingerly/web-js?style=flat-square" alt="Apache-2.0 licence"></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/banner.webp" alt="Fingerly" width="100%"></p>

## What is this

`@fingerly/web-js` is the Fingerly browser SDK. It reads the signals a browser
exposes, sends them to Fingerly, and returns a stable visitor ID with a suspect
score, so you can recognise returning visitors and spot automation, tampering
and abuse. [Fingerly](https://fingerly.io) helps you protect signups, logins and
payments from fraud and abuse.

Using a framework? The bindings wrap this package and install it for you:
[`@fingerly/react`](https://www.npmjs.com/package/@fingerly/react),
[`@fingerly/vue`](https://www.npmjs.com/package/@fingerly/vue),
[`@fingerly/next`](https://www.npmjs.com/package/@fingerly/next),
[`@fingerly/nuxt`](https://www.npmjs.com/package/@fingerly/nuxt),
[`@fingerly/svelte`](https://www.npmjs.com/package/@fingerly/svelte) and
[`@fingerly/angular`](https://www.npmjs.com/package/@fingerly/angular).

> **Not for apps.** Do not embed this SDK in an app's web view (iOS or macOS
> `WKWebView`, Android `WebView`, Capacitor, Cordova, Ionic, React Native WebView,
> Flutter, Electron). Inside an app it collects nothing and the server matches
> nothing; use the Fingerly iOS or Android SDK there. See section 3.3 of the
> [privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md).

## Getting started

1. **Get a key.** Create a public SDK key in the dashboard, scoped to the origins
   you list ([how keys work](https://docs.fingerly.io/docs/api-keys), and the
   [quick start](https://docs.fingerly.io/docs/quick-start)).
2. **Install.**

   ```sh
   npm install @fingerly/web-js
   # or: pnpm add @fingerly/web-js
   # or: yarn add @fingerly/web-js
   ```

3. **Load once, identify when it matters.**

   ```ts
   import { load } from '@fingerly/web-js'

   // A public SDK key from the dashboard. It is scoped to the origins you list,
   // which is what makes it safe to ship in the page.
   const fingerly = await load({ apiKey: 'fly_pk_production_…' })

   // Later, from your consent tool, or pass consent: 'granted' to load() if you
   // already have consent or know none is required here (see Consent below).
   fingerly.setConsent('granted')

   // When the visitor does something worth protecting: sign-up, login, checkout.
   const { requestId, visitorId, suspectLevel } = await fingerly.identify({ tag: 'login' })
   ```

Loading collects nothing and sends nothing. Consent defaults to `pending`, and
`identify()` rejects with a `ConsentError` until it is `granted`.

## Contents

- [Reading the answer](#reading-the-answer)
- [Consent](#consent)
- [Serve it from your own site](#serve-it-from-your-own-site)
- [Options](#options)
- [Errors](#errors)
- [Content Security Policy](#content-security-policy)
- [Without a bundler](#without-a-bundler)
- [TypeScript](#typescript)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Help](#help)
- [Licence](#licence)

## Reading the answer

This package collects and sends. Everything about the score is decided on the
server, under the weights you set: `suspectLevel` is the band, and it is `null`
when absent (unscored, or hidden by the SDK key), which is not a clean result.

Send `requestId` to your server and read the signals and the full result there
with a secret key (see the [server SDKs](https://docs.fingerly.io/docs/sdks)),
rather than trusting what the page reports: the page runs code the visitor
controls and is not told which signals fired. The walkthrough is in
[server-side verification](https://docs.fingerly.io/docs/server-side-verification).

## Consent

Consent is `'pending'` (the default), `'granted'` or `'denied'`. Until it is
`granted` nothing is collected and nothing is sent, and `identify()` and
`collect()` reject with a `ConsentError` (`code: 'consent_required'`, with the
`state`). `pending` and `denied` behave the same.

- Pass `consent` to `load()`, or call `setConsent(state)` on the client when your
  consent tool reports the answer. It is synchronous, and setting the current
  value again does nothing.
- `onConsentChange(listener)` runs on a change and returns the unsubscribe; read
  `consent` for the current state.
- Withdrawing consent while a call is running stops it before it submits.
- Anything other than the three states throws a `TypeError`, so a consent tool's
  `'accepted'` or `true` is refused loudly instead of read as an answer.

Pass `granted` only once the visitor has agreed, or where you have established
that this visitor needs none. See section 4 of the
[privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md),
[privacy and consent](https://docs.fingerly.io/docs/privacy-and-consent) and
[consent tools](https://docs.fingerly.io/docs/consent-tools).

## Serve it from your own site

Content blockers refuse requests to third-party hosts and to paths they know.
Create a proxy in the dashboard (**Integration > Proxy keys**), mount it at the
path it issued with one of the server SDKs or proxy templates, and point the
SDK at that path:

```ts
const fingerly = await load({
  apiKey: 'fly_pk_production_…',
  endpoints: '/k7x2qm4a',
  consent: 'granted',
})
```

The path is used exactly as given, with nothing appended. An array of paths
or URLs is tried in order when one does not answer (a `404` or `405` moves on
to the next at once).

Pair it with a server SDK that mounts the proxy: see
[proxy integrations](https://docs.fingerly.io/docs/proxy-integrations) and the
server SDK pages for
[Node](https://docs.fingerly.io/docs/sdks/node),
[Python](https://docs.fingerly.io/docs/sdks/python),
[Go](https://docs.fingerly.io/docs/sdks/go),
[Java](https://docs.fingerly.io/docs/sdks/java),
[.NET](https://docs.fingerly.io/docs/sdks/dotnet),
[PHP](https://docs.fingerly.io/docs/sdks/php),
[Ruby](https://docs.fingerly.io/docs/sdks/ruby),
[Rust](https://docs.fingerly.io/docs/sdks/rust) and
[Cloudflare Workers](https://docs.fingerly.io/docs/sdks/cloudflare-worker).

## Options

`load(options)` takes:

| Option | Type | Notes |
| --- | --- | --- |
| `apiKey` | `string` | Required. A public SDK key from the dashboard. |
| `endpoints` | `string \| string[]` | Ordered first-party ingestion URLs, posted to exactly as given: a root-relative path such as `/k7x2qm4a`, or an absolute URL. A bare origin such as `http://localhost:8099` is read as an API and gets the API's own path. No query or fragment. |
| `fallbackToDefaultEndpoint` | `boolean` | Try the Fingerly API after your custom endpoints fail, as a last resort. |
| `consent` | `'pending' \| 'granted' \| 'denied'` | Defaults to `pending`. |
| `apiVersion` | `string` | API route version. Defaults to `v1`. |
| `schedule` | object | Overrides for the collection scheduler: `budgetMs`, `defaultSourceTimeoutMs`, `concurrency`, `tiers`, `signal`. |
| `transport` | `Transport` | Replaces the HTTP transport, for tests or a custom network stack. |
| `sources` | array | Replaces the source set, for tests or a caller with a reason to run a subset. |

`identify(options)` and `collect(options)` take `tag` (echoed back on the
finished event, for your own correlation), `tiers`, `signal` (an `AbortSignal`
that cancels collection and submission) and `submit`. With `submit: false`
nothing is sent: the report is collected, and everything the server decides
comes back empty (no `requestId`, no `visitorId`, `suspectScore` and
`suspectLevel` null rather than zero). That is the honest answer rather than a
gap, because nobody scored it. `collect()` runs the collectors and returns the
report without submitting, and consent applies to it too.

## Errors

- `load()` rejects for a configuration mistake, such as a missing `apiKey`.
  It never throws synchronously, so a misconfigured key cannot take the page
  down with it.
- `identify()` rejects with a `ConsentError` while consent is not `granted`,
  and with a `TransportError` when the request cannot be completed. Branch on
  its `status` and `retryable`. When the server asks for patience (`429` or
  `503` with `Retry-After`), `retryAfterMs` says how long; a wait of up to two
  seconds is taken care of before the error would be raised. A retry reuses
  the first attempt's idempotency key, so it is never counted twice.

`TransportError` also carries the server's error `code` when it sent one. The
two statuses worth branching on are `401` (the key is wrong, or was used from an
origin it does not list) and `402` (the organisation is not accepting traffic).
Both are your configuration rather than the visitor's. The full list is in the
[error reference](https://docs.fingerly.io/reference/errors).

## Content Security Policy

With a first-party proxy the SDK needs nothing beyond what your page already
allows: `connect-src 'self'` covers the proxy path, and the script itself is
your own bundle or `script-src 'self'` for the script-tag build. Under a policy
without `'unsafe-eval'`, one check that compiles a string is refused by the
browser, once per page load; the SDK skips it and its sibling and carries on.
That refusal is reported to your `report-uri` or `report-to` endpoint if you
have one, as one `script-src` (`eval`) violation per page view. See
[Content Security Policy](https://docs.fingerly.io/docs/content-security-policy).

Firefox prints two deprecation warnings while the SDK reads the graphics
renderer and the motion sensor. They come from the browser, change nothing
for the visitor, and are not errors.

## Without a bundler

The package includes a minified script-tag build, `dist/browser.global.js`,
which defines a global `Fingerly`. Serve it from your own site under a neutral
name and load it before your code:

```html
<script src="/assets/app-core.js"></script>
<script>
  Fingerly.load({ apiKey: 'fly_pk_production_…', consent: 'granted' })
    .then((fingerly) => fingerly.identify({ tag: 'login' }))
    .then((result) => console.log(result.requestId))
</script>
```

## TypeScript

The package ships its own types (`dist/index.d.ts`), as ES modules and CommonJS.
It exports `FingerlyOptions` for `load()`, and re-exports the types you receive
so you do not need the kernel as a dependency: `IdentifyOptions`,
`IdentifyResult`, `ConsentState`, `SignalReport`, `SignalOutcome`,
`SignalStatus`, `IntegrityReport`, `Lie`, `Confidence`, `FingerlyEvent` and
`FingerlyWebEvent`. The values `FingerlyClient`, `ConsentError`,
`TransportError` and `isSuspiciousLevel` are exported too, so a handler can
branch with `instanceof`. The package is side-effect free, so a bundler can tree
shake what you do not import.

## Requirements

A browser that runs ES2020 with `fetch` and `AbortController`: every current
version of Chrome, Edge, Firefox and Safari. A public SDK key whose allowed
origins include your page. The SDK runs in a browser page only; see the note on
apps above.

## Documentation

The full guide, including consent tools, first-party proxies and the server
side, is at [docs.fingerly.io](https://docs.fingerly.io/docs/sdks/javascript).

## Help

Open an issue on [fingerly-io/sdks](https://github.com/fingerly-io/sdks/issues),
or write to [support@fingerly.io](mailto:support@fingerly.io). Security issues:
[security@fingerly.io](mailto:security@fingerly.io).

## Licence

[Apache-2.0](https://github.com/fingerly-io/sdks/blob/main/client/web/web-js/LICENSE). Fingerly is a product of Badele LLC.
