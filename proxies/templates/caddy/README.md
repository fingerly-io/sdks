# Fingerly first-party proxy for Caddy

A `handle` block for the Caddy site that already serves your pages. It answers
one path the Fingerly dashboard issued, on your own host, and forwards only the
browser SDK's submissions to the Fingerly API. It is not an open proxy: the
upstream is fixed in the configuration, and every other path and method is
refused.

## Steps

1. In the dashboard, open **Integration > Proxy keys**, create a proxy and copy
   the key it shows once. Note the path it issued, such as `/k7x2qm4a`.
2. Copy the `@fingerly` matcher and the `handle @fingerly { ... }` block from
   `Caddyfile` into your site block, first among its handlers, and replace
   `/k7x2qm4a` with your path in the matcher.
3. Put the key in its own file, readable only by root, as the
   `FINGERLY_PROXY_KEY` environment variable of the Caddy process, never in
   the Caddyfile. The prompt does not echo: paste the key and press Enter.
   The key never appears on a command line, so it stays out of your shell
   history and the process list:

   ```sh
   sudo install -m 600 -o root -g root /dev/null /etc/caddy/fingerly.env
   printf 'Proxy key: ' && read -rs proxy_key && echo &&
     printf 'FINGERLY_PROXY_KEY=%s\n' "$proxy_key" | sudo tee /etc/caddy/fingerly.env >/dev/null; unset proxy_key
   ```

4. With systemd, run `sudo systemctl edit caddy` and point the service at
   the file:

   ```ini
   [Service]
   EnvironmentFile=/etc/caddy/fingerly.env
   ```

   systemd reads the file as root before it starts Caddy. Never put the key
   itself in the override with `Environment=`: unit files are readable by
   every user on the machine, and `systemctl show caddy` prints it. In a
   container, pass the same file with `--env-file` or take the key from your
   secret store.
5. Restart, so Caddy sees the new environment: `sudo systemctl restart caddy`.
6. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
     consent: 'granted', // only once the visitor has agreed, or you have another lawful basis
   })
   ```

`header_up Host {upstream_hostport}` is automatic for HTTPS upstreams since
Caddy 2.11; it stays in the block for older versions.

## Exactly one path

Caddy's `path` matcher ignores case and matches after resolving dot segments
such as `/x/../k7x2qm4a`, merging doubled slashes and decoding characters such
as `%61`. The `@fingerly` matcher compares the raw request target,
`{http.request.orig_uri}`, instead: exactly the path, optionally followed by a
query string. Anything else falls through to the rest of your site, so no
prefix, trailing slash, doubled slash, dot segment or encoded character is
forwarded, and the match is case-sensitive.

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
