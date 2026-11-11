# Fingerly first-party proxy for Netlify

A dependency-free Edge Function for any site on Netlify. It answers one path
the Fingerly dashboard issued, on your own domain, and forwards only the
browser SDK's submissions to the Fingerly API. It is not an open proxy: the
upstream is a constant in the code, and every other path and method is refused.

## Steps

1. In the dashboard, open **Integration > Proxy keys**, create a proxy and copy
   the key it shows once. Note the path it issued, such as `/k7x2qm4a`.
2. Save `edge-functions/relay.ts` as `netlify/edge-functions/relay.ts` in your
   site and replace `/k7x2qm4a` with your path in `PATH`.
3. Bind it to the same path in `netlify.toml`:

   ```toml
   [[edge_functions]]
     function = "relay"
     path = "/k7x2qm4a"
   ```

4. Add the key in the Netlify UI, under **Project configuration > Environment
   variables**, as a variable with the **Functions** scope:

   ```text
   Key:    FINGERLY_PROXY_KEY
   Value:  fly_px_production_...
   Scopes: Functions
   ```

   Use the UI rather than `netlify env:set`, which takes the value on the
   command line and so leaves the key in your shell history.
5. Deploy.
6. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
     consent: 'granted', // only once the visitor has agreed, or you know none is needed (docs/privacy.md §4)
   })
   ```

## Exactly one path

The function answers only when the request path is exactly `PATH`: no
trailing or doubled slash, no encoded slash or character, case-sensitive; a
query string is ignored. Dot segments such as `/x/../k7x2qm4a` are resolved
before the function reads the request URL, so those reach it as the path
itself.

## How the visitor's address is trusted

The function sends `context.ip`, the address Netlify's edge accepted the
connection from, as `x-fingerly-client-ip`. It is not read from any header, so
the visitor cannot change it. Should it ever not be exactly one IPv4 or IPv6
address, nothing is forwarded: the function answers `500` ("The client IP
callback returned no valid address") and logs that once per instance.

## What it sends and relays

Upstream, to `https://api.fingerly.io/api/v1/ingest` only, on headers built
from scratch: `content-type`, `x-api-key`, `idempotency-key` when present, and
the `x-fingerly-*` headers the function sets itself (the proxy key, the client
address, the page origin, the user agent and
`x-fingerly-proxy-version: netlify/1.0.0`, which the dashboard shows per
proxy). Cookies, `Authorization` and any `x-fingerly-*` header a visitor forges
never leave. Bodies over 1 MiB are refused with `413`, redirects are not
followed, and a missing or malformed key answers `503` rather than forwarding.

Back to the page: the API's status and body with only `content-type`,
`x-request-id`, `ratelimit-limit`, `ratelimit-remaining` and `retry-after`,
plus `cache-control: no-store`. Nothing relayed names Fingerly.
