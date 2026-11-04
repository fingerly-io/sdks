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
     consent: 'granted', // only once the visitor has agreed, or you have another lawful basis
   })
   ```

## Exactly one path

The service compares the raw request target, before any URL parsing: exactly
`FINGERLY_PATH`, optionally followed by a query string. A doubled slash, a dot
segment such as `/x/../k7x2qm4a`, an encoded slash or character, a trailing
slash or another case answers `404` and is not forwarded. A front proxy that
cleans paths before forwarding (Traefik does) hands the service the cleaned
path, which it cannot tell apart from the real one.

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
to send. `X-Forwarded-For` is counted from the right because each proxy appends
the address it accepted the connection from; entries to the left of yours are
not vouched for by anyone. Which position is the visitor depends on what is in
front:

| In front of the container | Source |
| --- | --- |
| nothing: visitors connect to it directly | `remote` |
| one proxy that appends the connection address (nginx with `$proxy_add_x_forwarded_for`, Caddy, Traefik, an AWS Application Load Balancer in its default append mode) | `xff:1` |
| Traefik, reached directly, in its default configuration | `header:x-real-ip` (see the Traefik template) |
| a Google Cloud external Application Load Balancer, which appends `<client-ip>,<load-balancer-ip>` | `xff:2` |
| a load balancer that appends one entry, then a proxy that appends one | `xff:2` |

Count only hops you run and that every request passes through: anything that
can reach the container another way can write the entries you count on. When
the source does not hold exactly one IPv4 or IPv6 address (the header is
missing or repeated, there are too few `X-Forwarded-For` entries, or the value
is not an address), nothing is forwarded: the service answers `500` ("The
client IP callback returned no valid address") and logs that once per
process.

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
