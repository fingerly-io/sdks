# Fingerly first-party proxy templates

Ready-made first-party proxies for sites that run neither the Cloudflare
Worker (`../cloudflare`) nor one of the server SDKs. Each one answers the one
path the Fingerly dashboard issued, on your own host, and forwards only the
browser SDK's submissions to `https://api.fingerly.io/api/v1/ingest`.

| Template | Kind | Files |
| --- | --- | --- |
| [nginx](nginx/README.md) | `nginx/1.0.0` | `fingerly.conf`, `fingerly-proxy-key.conf.example` |
| [Caddy](caddy/README.md) | `caddy/1.0.0` | `Caddyfile` |
| [Vercel](vercel/README.md) | `vercel/1.0.0` | `middleware.ts` |
| [Netlify](netlify/README.md) | `netlify/1.0.0` | `edge-functions/relay.ts`, `netlify.toml` |
| [AWS CloudFront](aws-cloudfront/README.md) | `aws-cloudfront/1.0.0` | `function.js`, `cloudformation.yaml` |
| [Google Cloud Run](gcp-cloud-run/README.md) | `gcp-cloud-run/1.0.0` | `server.mjs`, `package.json` |
| [Container](container/README.md) | `container/1.0.0` | `server.mjs`, `Dockerfile` |
| [Traefik](traefik/README.md) | `container/1.0.0` (it runs the container) | `docker-compose.yml`, `dynamic.yml`, `kubernetes.yaml` |

The kind is what each template sends as `x-fingerly-proxy-version`, which the
dashboard shows per proxy. The container and Cloud Run templates ship the same
`server.mjs`, differing only in its `PRESET` line (kind and default client
address source); a test holds them to that. Traefik cannot copy the client
address into a header by configuration alone, so its template routes the path
to the container.

## What every template does

- Answers exactly the issued path (`/k7x2qm4a` in the examples), nothing under
  or beside it, and only `POST` (`405` with `Allow: POST` otherwise). The raw
  request target is compared, so a doubled slash, a dot segment such as
  `/x/../k7x2qm4a`, an encoded slash or character, or another case is not
  forwarded; a query string is ignored. Two platforms clean the path before
  the template sees it: Traefik resolves dot segments, doubled slashes and
  encoded characters before routing, and on Vercel and Netlify the request URL
  arrives with dot segments already resolved. Those forms reach the API as the
  issued path itself.
- Forwards to the one constant upstream, never anywhere else, and follows no
  redirects.
- Sends `content-type`, `x-api-key`, `idempotency-key` when present, and sets
  `x-fingerly-proxy-key`, `x-fingerly-client-ip` (from the platform's trusted
  source, never the left-most `X-Forwarded-For`), `x-fingerly-origin`,
  `x-fingerly-user-agent` and `x-fingerly-proxy-version` itself, overwriting
  anything the visitor sent under those names.
- Forwards nothing and answers `500` ("The client IP source returned no valid
  address") when the trusted source does not hold exactly one IPv4 or IPv6
  address, and logs that once rather than per request.
- Never forwards cookies or `Authorization`, and caps bodies at 1 MiB where the
  platform can see them.
- Gives the whole upstream exchange one 5-second deadline and reads the answer
  in full, up to 4 MiB, before sending anything back. A timeout answers `504`
  ("Gateway timeout"); an unreachable API, a broken answer or one over the cap
  answers `502` ("Bad gateway"), never a truncated success. These apply to the
  Vercel, Netlify, container and Cloud Run templates; nginx and Caddy answer
  `504` and `502` with their own timeouts.
- Relays only `content-type`, `x-request-id`, `ratelimit-limit`,
  `ratelimit-remaining` and `retry-after`, plus `cache-control: no-store`.
  nginx and Caddy drop `Set-Cookie` and pin `no-store`; the API sends nothing
  naming Fingerly to proxied callers, so that is defense in depth.
- Keeps the proxy key out of shipped files: an environment variable, a secret
  store, a root-only include file or a `NoEcho` parameter.

Point the browser SDK at the path with `endpoints: '/k7x2qm4a'`.

## Tests

```sh
pnpm install
pnpm --filter @fingerly/proxy-templates test
```

`tests/conformance.test.ts` runs the same cases against the Vercel, Netlify,
container, Cloud Run and CloudFront code with a stubbed upstream.
`tests/servers.test.ts` runs nginx, Caddy, the container image and Traefik
(file provider and compose labels, `traefik:v3`) for real in Docker against a
stub API, from test copies of the shipped files with only the upstream
swapped; it is skipped when Docker is not running.

`console-snippets.json` holds the steps the dashboard prints for each kind. It
is generated from the template files by `pnpm run snippets`, and a test fails
when it is out of date.
