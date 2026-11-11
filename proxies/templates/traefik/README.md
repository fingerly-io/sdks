# Fingerly first-party proxy behind Traefik

Traefik's configuration alone cannot copy the visitor's address into a header
(the headers middleware only sets fixed values), so this template routes the
one path the Fingerly dashboard issued to the `container` template, which does
the forwarding. The router answers exactly that path, on your own host; the
container forwards only the browser SDK's submissions to the Fingerly API.

- `docker-compose.yml`: the container as a compose service, with the router in
  its labels, for Traefik's Docker provider.
- `dynamic.yml`: the same router and service for Traefik's file provider.
- `kubernetes.yaml`: a Deployment, a Service and an `IngressRoute`.

## Steps

1. In the dashboard, open **Integration > Proxy keys**, create a proxy and copy
   the key it shows once. Note the path it issued, such as `/k7x2qm4a`.
2. Copy the container template's `Dockerfile` and `server.mjs` into a
   `site-relay` folder beside your compose file.
3. Add the `site-relay` service from `docker-compose.yml` to the compose
   project Traefik routes, on a network Traefik can reach, and replace
   `/k7x2qm4a` with your path in `FINGERLY_PATH` and in the router rule. If
   your other routers name `entrypoints` or `tls` in their labels, add the same
   to this one.
4. Beside your compose file, put the key in `site-relay.env`, readable only by
   you, and keep it out of version control. The prompt does not echo: paste
   the key and press Enter. The key never appears on a command line, so it
   stays out of your shell history and the process list:

   ```sh
   install -m 600 /dev/null site-relay.env
   printf 'Proxy key: ' && read -rs proxy_key && echo &&
     printf 'FINGERLY_PROXY_KEY=%s\n' "$proxy_key" > site-relay.env; unset proxy_key
   ```

5. Start it:

   ```sh
   docker compose up -d --build site-relay
   ```

6. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
     consent: 'granted', // only once the visitor has agreed, or you know none is needed (docs/privacy.md §4)
   })
   ```

With the file provider, run the container as `site-relay` on a network Traefik
can reach and add `dynamic.yml` to your dynamic configuration.

On Kubernetes, push the image to your registry, and put its name and your
path in place of the examples in `kubernetes.yaml`. Write the key to a file only you can read, from the same
kind of prompt (without a trailing newline, which would make it an invalid
key):

```sh
install -m 600 /dev/null site-relay-key
printf 'Proxy key: ' && read -rs proxy_key && echo &&
  printf '%s' "$proxy_key" > site-relay-key; unset proxy_key
```

Then create the Secret from the file, remove the file and apply the manifest:

```sh
kubectl create secret generic site-relay --from-file=proxy-key=site-relay-key; rm -f site-relay-key
kubectl apply -f kubernetes.yaml
```

The router has `priority: 10000`. Traefik otherwise ranks routers by rule
length, so a longer catch-all rule for your site would win over
`Path(`/k7x2qm4a`)`.

## Exactly one path

`Path(`/k7x2qm4a`)` is case-sensitive and refuses a trailing slash, a doubled
trailing slash and an encoded slash. Traefik cleans the path before routing,
though: it resolves dot segments (`/x/../k7x2qm4a`), merges a leading doubled
slash and decodes percent-encoded characters (`/k7x2qm4%61`), and forwards the
cleaned path, so the container sees `/k7x2qm4a` for those and forwards them.
They are the same resource, and no configuration of Traefik's routers changes
it.

## How the visitor's address is trusted

The container reads `X-Real-Ip` (`FINGERLY_CLIENT_IP_SOURCE=header:x-real-ip`).
For a request from an address outside `forwardedHeaders.trustedIPs`, Traefik
deletes every `X-Forwarded-*` and `X-Real-Ip` header the client sent and sets
`X-Real-Ip` to the address of the connection it accepted, so a visitor cannot
forge it. This is the default, with no trusted IPs configured.

- **Traefik behind a load balancer** listed in `forwardedHeaders.trustedIPs`:
  Traefik keeps the `X-Real-Ip` the load balancer sent, and only sets it when
  there is none. Keep `header:x-real-ip` if the load balancer sets `X-Real-Ip`
  itself on every request. If it only appends to `X-Forwarded-For`, use
  `xff:2` instead: the load balancer appends the visitor, then Traefik appends
  the load balancer.
- **Never** set `forwardedHeaders.insecure`: Traefik then keeps whatever the
  visitor sent.
- **Kubernetes**: Traefik sees the visitor's address only when its own Service
  preserves it (`externalTrafficPolicy: Local`, or PROXY protocol from the load
  balancer). Otherwise every request carries a node's address.

## What it sends and relays

The container sends, to `https://api.fingerly.io/api/v1/ingest` only:
`content-type`, `x-api-key`, `idempotency-key` when present, and the
`x-fingerly-*` headers it sets itself (the proxy key, the client address, the
page origin, the user agent and `x-fingerly-proxy-version: container/1.0.0`,
which the dashboard shows per proxy). Cookies, `Authorization` and any
`x-fingerly-*` header a visitor forges never leave. Bodies over 1 MiB are
refused with `413`, other methods answer `405` with `Allow: POST`, redirects
are not followed, and a missing or malformed key answers `503`.

Back to the page: the API's status and body with only `content-type`,
`x-request-id`, `ratelimit-limit`, `ratelimit-remaining` and `retry-after`,
plus `cache-control: no-store`. Traefik adds nothing to the response, and
nothing relayed names Fingerly.
