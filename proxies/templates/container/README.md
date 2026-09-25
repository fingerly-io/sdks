# Fingerly first-party proxy container

A small, dependency-free Node service (`server.mjs`) and a `Dockerfile` for any
platform that runs containers. Your front proxy or load balancer routes the one
path the Fingerly dashboard issued to it, on your own host, and it forwards only
the browser SDK's submissions to the Fingerly API. It is not an open proxy: the
upstream is a constant in the code, and every other path and method is refused.
The image runs as an unprivileged user.

## Steps

1. In the dashboard, open **Integration > Proxy keys**, create a proxy and copy
   the key it shows once. Note the path it issued, such as `/k7x2qm4a`.
2. Build the image from this folder: `docker build -t site-relay .`
3. Run it with the path, the key from your secret store (never a file in
   version control) and the client address source that fits what sits in
   front of it (see below; `remote` is right only when visitors connect to the
   container directly):

   ```sh
   export FINGERLY_PROXY_KEY=fly_px_production_...   # from your secret store
   docker run -d --name site-relay --restart unless-stopped -p 8080:8080 \
     -e FINGERLY_PATH=/k7x2qm4a -e FINGERLY_PROXY_KEY \
     -e FINGERLY_CLIENT_IP_SOURCE=remote \
     site-relay
   ```

4. Route exactly `/k7x2qm4a` on your site's host to the container, `POST`
   bodies included, from the proxy or load balancer in front of it.
5. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
   })
   ```

## How the visitor's address is trusted

`FINGERLY_CLIENT_IP_SOURCE` says where the visitor's address comes from. The
service sends it as `x-fingerly-client-ip`, and refuses to start when the value
is not one of these:

| Value | Reads | Safe when |
| --- | --- | --- |
| `remote` (default) | the address of the connection | visitors connect to the container directly |
| `header:<name>` | one header, such as `header:x-real-ip` | the proxy in front sets that header on every request, overwriting what the visitor sent |
| `xff:<n>` | the n-th `X-Forwarded-For` entry from the right | your own proxies append exactly n-1 entries after the visitor's address |

Only a header the front proxy overwrites is safe. A header it merely passes
along, or the left-most `X-Forwarded-For` entry, is whatever the visitor chose
to send. Behind one proxy that appends the connection address to
`X-Forwarded-For`, `xff:1` is right; behind a load balancer and then a proxy
that each append one, `xff:2`. A repeated header, or a value that is not an IP
address, is sent as empty, and the API then refuses the call rather than
guessing.

## What it sends and relays

Upstream, to `https://api.fingerly.io/api/v1/ingest` only, on headers built
from scratch: `content-type`, `x-api-key`, `idempotency-key` when present, and
the `x-fingerly-*` headers the service sets itself (the proxy key, the client
address, the page origin, the user agent and
`x-fingerly-proxy-version: container/1.0.0`, which the dashboard shows per
proxy). Cookies, `Authorization` and any `x-fingerly-*` header a visitor forges
never leave. Bodies over 1 MiB are refused with `413`, redirects are not
followed, and a missing or malformed key answers `503` rather than forwarding.
With `FINGERLY_PATH` unset the service answers `404` to everything.

Back to the page: the API's status and body with only `content-type`,
`x-request-id`, `ratelimit-limit`, `ratelimit-remaining` and `retry-after`,
plus `cache-control: no-store`. Nothing relayed names Fingerly.

`server.mjs` is the same file the `gcp-cloud-run` template ships; only its
`PRESET` line differs.
