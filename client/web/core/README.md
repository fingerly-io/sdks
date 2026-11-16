# @fingerly/core

The platform-independent single-pass `v: 3` kernel (`0.3.0`) of the Fingerly
browser SDKs:

- **Single-pass two-stage scheduler (`<= 350 ms` default budget):** runs Stage 1
  (`prerequisite`, completing `engine` and the `<= 3 ms` Gecko RFP timer guard)
  as a barrier before Stage 2 (`collect`), with per-source timeouts and zero
  follow-up sidecar requests.
- **Consent gate:** defaults to `'pending'`, aborts in-flight collection or
  submission on withdrawal, and enforces `'granted'` before `identify()` or
  `collect()` runs.
- **Incognito mode control (`incognitoDetection: 'standard' | 'extended'`):**
  gates opt-in extended incognito probes (`storage_durability`) while keeping
  zero-write `'standard'` probes as the default.
- **DPLA-safe embedded WebView filter (`EMBEDDED_SAFE_SOURCES`):** restricts
  detected in-app WebViews to non-identifying runtime/integrity sources and skips
  device-fingerprinting collectors.
- **1-RTT `v: 3` transport & Option B normalization:** posts to
  `POST /api/v1/ingest` with idempotent retries and guarantees `visitorId === ""`
  and `visitorIsNew === false` whenever `identifiable === false`.

It contains no DOM code of its own and decides nothing: scoring lives on the
server.

```sh
pnpm add @fingerly/web-js@^0.3.0
```

You almost certainly want [`@fingerly/web-js`](https://www.npmjs.com/package/@fingerly/web-js)
instead, or one of the framework bindings built on it (`@fingerly/react`,
`@fingerly/next`, `@fingerly/vue`, `@fingerly/nuxt`, `@fingerly/svelte`,
`@fingerly/angular`). They install `@fingerly/core` (`0.3.0`) for you.

Documentation: [docs.fingerly.io](https://docs.fingerly.io/docs/sdks/javascript)

## Licence

Apache-2.0
