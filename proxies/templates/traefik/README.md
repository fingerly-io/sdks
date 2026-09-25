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
4. Provide the key from the shell or an `.env` file kept out of version
   control, then start it: `FINGERLY_PROXY_KEY=fly_px_production_... docker compose up -d --build site-relay`.
5. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
   })
   ```

With the file provider, run the container as `site-relay` on a network Traefik
can reach and add `dynamic.yml` to your dynamic configuration. On Kubernetes,
push the image to your registry, create the Secret named in
`kubernetes.yaml` and apply it.

The router has `priority: 10000`. Traefik otherwise ranks routers by rule
length, so a longer catch-all rule for your site would win over
`Path(`/k7x2qm4a`)`.

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
