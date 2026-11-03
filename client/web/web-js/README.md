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
const { requestId, visitorId, suspectScore } = await fingerly.identify({ tag: 'login' })
```

Loading collects nothing and sends nothing. Consent defaults to `pending`, and
`identify()` rejects with a `ConsentError` until it is `granted`.

Send `requestId` to your server and read the full result there with a secret
key (see the server SDKs), rather than trusting what the page reports: the page
runs code the visitor controls.

## Errors

- `load()` throws for a configuration mistake, such as a missing `apiKey`.
- `identify()` rejects with a `ConsentError` while consent is not `granted`,
  and with a `TransportError` when the request cannot be completed. Branch on
  its `status` and `retryable`.

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
