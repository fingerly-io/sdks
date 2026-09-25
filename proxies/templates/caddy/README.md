# Fingerly first-party proxy for Caddy

A `handle` block for the Caddy site that already serves your pages. It answers
one path the Fingerly dashboard issued, on your own host, and forwards only the
browser SDK's submissions to the Fingerly API. It is not an open proxy: the
upstream is fixed in the configuration, and every other path and method is
refused.

## Steps

1. In the dashboard, open **Integration > Proxy keys**, create a proxy and copy
   the key it shows once. Note the path it issued, such as `/k7x2qm4a`.
2. Copy the `handle /k7x2qm4a { ... }` block from `Caddyfile` into your site
   block, first among its handlers, and replace `/k7x2qm4a` with your path.
3. Give the Caddy process the key as the `FINGERLY_PROXY_KEY` environment
   variable, never in the Caddyfile. With systemd, run
   `sudo systemctl edit caddy` and add:

   ```ini
   [Service]
   Environment=FINGERLY_PROXY_KEY=fly_px_production_...
   ```

   or point `EnvironmentFile=` at a file readable only by root. In a
   container, pass it from your secret store.
4. Restart, so Caddy sees the new environment: `sudo systemctl restart caddy`.
5. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
     consent: 'granted', // only once the visitor has agreed, or you have another lawful basis
   })
   ```

`header_up Host {upstream_hostport}` is automatic for HTTPS upstreams since
Caddy 2.11; it stays in the block for older versions.

## How the visitor's address is trusted

The proxy sends `{client_ip}` as `x-fingerly-client-ip`. With no
`trusted_proxies` configured, that is the address of the connection Caddy
accepted, and nothing the visitor sends can change it.

When Caddy sits behind a load balancer or CDN, trust only its addresses, and
parse `X-Forwarded-For` from the right so entries a visitor adds on the left
are ignored:

```caddy
{
	servers {
		trusted_proxies static 10.0.0.0/8
		trusted_proxies_strict
	}
}
```

Without `trusted_proxies_strict`, Caddy reads the header left to right, where a
visitor can write anything.

## What it sends and relays

Upstream, to `https://api.fingerly.io/api/v1/ingest` only: the request with
`Cookie` and `Authorization` removed, every visitor-sent `X-Fingerly-*` header
removed, and the `x-fingerly-*` headers the proxy sets itself (the proxy key,
the client address, the page origin, the user agent and
`x-fingerly-proxy-version: caddy/1.0.0`, which the dashboard shows per proxy).
Bodies over 1 MiB are refused with `413`, redirects are not followed, and a
missing or malformed key answers `503`. Other methods answer `405` with
`Allow: POST`.

Back to the page: the API's status and body, with `Set-Cookie` dropped and
`Cache-Control: no-store`. The API itself sends nothing naming Fingerly to
proxied callers, and the server tests that, so dropping headers here is defense
in depth.
