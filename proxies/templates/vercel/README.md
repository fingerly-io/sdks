# Fingerly first-party proxy for Vercel

A dependency-free Routing Middleware file for any project on Vercel. It answers
one path the Fingerly dashboard issued, on your own domain, and forwards only
the browser SDK's submissions to the Fingerly API. It is not an open proxy: the
upstream is a constant in the code, and every other path and method is refused.

## Steps

1. In the dashboard, open **Integration > Proxy keys**, create a proxy and copy
   the key it shows once. Note the path it issued, such as `/k7x2qm4a`.
2. Save `middleware.ts` at the root of your project, beside `package.json`, and
   replace `/k7x2qm4a` with your path in both places (`config.matcher` and
   `PATH`).
3. Add the key as a sensitive environment variable. The CLI prompts for the
   value, so the key stays out of your shell history:

   ```sh
   vercel env add FINGERLY_PROXY_KEY production --sensitive
   ```

   Or use **Settings > Environment Variables** in the project, with
   **Sensitive** on.
4. Deploy.
5. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
     consent: 'granted', // only once the visitor has agreed, or you have another lawful basis
   })
   ```

On Next.js, use a route handler instead: `app/k7x2qm4a/route.ts` exporting
`POST = Fingerly.createProxy(...)` from `@fingerly/node`, which leaves your
Next.js middleware alone.

## Exactly one path

The middleware answers only when the request path is exactly `PATH`: no
trailing or doubled slash, no encoded slash or character, case-sensitive; a
query string is ignored. Dot segments such as `/x/../k7x2qm4a` are resolved
before the middleware reads the request URL, so those reach it as the path
itself.

## How the visitor's address is trusted

The middleware sends `x-real-ip` as `x-fingerly-client-ip`, and reads nothing
else. Vercel sets that header on every request to the address its edge
accepted the connection from, replacing whatever the visitor sent, so on
Vercel it cannot be forged. `x-forwarded-for` is never a fallback: wherever its
entries are passed along rather than rewritten, the left-most one is whatever
the visitor chose to write. When `x-real-ip` is missing or is not exactly one
IPv4 or IPv6 address, nothing is forwarded: the middleware answers `500` ("The
client IP callback returned no valid address") and logs that once per
instance. Do not reuse this code on a platform that passes `x-real-ip` through
from the visitor.

## What it sends and relays

Upstream, to `https://api.fingerly.io/api/v1/ingest` only, on headers built
from scratch: `content-type`, `x-api-key`, `idempotency-key` when present, and
the `x-fingerly-*` headers the middleware sets itself (the proxy key, the
client address, the page origin, the user agent and
`x-fingerly-proxy-version: vercel/1.0.0`, which the dashboard shows per proxy).
Cookies, `Authorization` and any `x-fingerly-*` header a visitor forges never
leave. Bodies over 1 MiB are refused with `413`, redirects are not followed,
and a missing or malformed key answers `503` rather than forwarding.

Back to the page: the API's status and body with only `content-type`,
`x-request-id`, `ratelimit-limit`, `ratelimit-remaining` and `retry-after`,
plus `cache-control: no-store`. Nothing relayed names Fingerly.
