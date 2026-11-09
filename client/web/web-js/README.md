# @fingerly/web-js

The Fingerly browser SDK. It reads the signals a browser exposes, sends them to
Fingerly, and returns a stable visitor ID with a suspect score, so you can
recognise returning visitors and spot automation, tampering and abuse.

```
npm install @fingerly/web-js
```

Using a framework? The bindings wrap this package:
[`@fingerly/react`](https://www.npmjs.com/package/@fingerly/react),
[`@fingerly/vue`](https://www.npmjs.com/package/@fingerly/vue),
[`@fingerly/next`](https://www.npmjs.com/package/@fingerly/next),
[`@fingerly/nuxt`](https://www.npmjs.com/package/@fingerly/nuxt),
[`@fingerly/svelte`](https://www.npmjs.com/package/@fingerly/svelte) and
[`@fingerly/angular`](https://www.npmjs.com/package/@fingerly/angular).

## Load once, identify when it matters

```ts
import { load } from '@fingerly/web-js'

// A public SDK key from the dashboard. It is scoped to the origins you list,
// which is what makes it safe to ship in the page.
const fingerly = await load({ apiKey: 'fly_pk_production_…' })

// Later, from your consent tool, or pass consent: 'granted' to load() if you
// already have consent or another lawful basis.
fingerly.setConsent('granted')

// When the visitor does something worth protecting: sign-up, login, checkout.
const { requestId, visitorId, suspectLevel } = await fingerly.identify({ tag: 'login' })
```

Loading collects nothing and sends nothing. Consent defaults to `pending`, and
`identify()` rejects with a `ConsentError` until it is `granted`.

This package collects and sends. Everything about the score is decided on the
server, under the weights you set: `suspectLevel` is the band, and it is `null`
when absent (unscored, or hidden by the SDK key), which is not a clean result.
Send `requestId` to your server and read the signals and the full result there
with a secret key (see the server SDKs), rather than trusting what the page
reports: the page runs code the visitor controls and is no longer told which
signals fired.

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
or URLs is tried in order when one does not answer.

## Content Security Policy

With a first-party proxy the SDK needs nothing beyond what your page already
allows: `connect-src 'self'` covers the proxy path, and the script itself is
your own bundle or `script-src 'self'` for the script-tag build. Under a policy
without `'unsafe-eval'`, one check that compiles a string is refused by the
browser, once per page load; the SDK skips it and its sibling and carries on.
That refusal is reported to your `report-uri` or `report-to` endpoint if you
have one, as one `script-src` (`eval`) violation per page view.

Firefox prints two deprecation warnings while the SDK reads the graphics
renderer and the motion sensor. They come from the browser, change nothing
for the visitor, and are not errors.

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

## Documentation

The full guide, including consent tools, first-party proxies and the server
side, is at [docs.fingerly.io](https://docs.fingerly.io/docs/sdks/javascript).

## Licence

Apache-2.0
