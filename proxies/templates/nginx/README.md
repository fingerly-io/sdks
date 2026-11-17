# Fingerly first-party proxy for nginx

A `location` block for the nginx server that already serves your site. It
answers one path the Fingerly dashboard issued, on your own host, and forwards
single-pass browser and native SDK submissions as raw bytes to the Fingerly
API. It is not an open proxy: the upstream is fixed in the configuration, and
every other path and method is refused.

## Steps

1. In the dashboard, open **Integration > Proxy keys**, create a proxy and copy
   the key it shows once. Note the path it issued, such as `/k7x2qm4a`.
2. Copy `fingerly.conf` to `/etc/nginx/snippets/fingerly.conf` and replace
   `/k7x2qm4a` with your path in both places: the `location` and the
   `$request_uri` check inside it.
3. Put the key in its own file, readable only by root, and keep it out of
   version control. The prompt does not echo: paste the key and press Enter.
   The key never appears on a command line, so it stays out of your shell
   history and the process list:

   ```sh
   sudo install -m 600 -o root -g root /dev/null /etc/nginx/fingerly-proxy-key.conf
   printf 'Proxy key: ' && read -rs proxy_key && echo &&
     printf 'set $fingerly_proxy_key "%s";\n' "$proxy_key" | sudo tee /etc/nginx/fingerly-proxy-key.conf >/dev/null; unset proxy_key
   ```

   If `/etc/nginx` is in a repository, add `fingerly-proxy-key.conf` to its
   `.gitignore`. `fingerly-proxy-key.conf.example` shows the format.
4. Copy `fingerly.js` to `/etc/nginx/fingerly.js`. It is the response header
   allowlist, run by the njs module (`ngx_http_js_module`), which ships with
   the nginx packages and images from nginx.org.
5. Load the njs module in the main context of `nginx.conf`, define the native
   SDK platform allowlist in `http` and include the snippet inside the
   `server` block for your site:

   ```nginx
   # Main context, beside the other load_module lines.
   load_module modules/ngx_http_js_module.so;

   # In http:
   map "$http_origin:$http_x_fingerly_sdk_platform" $fingerly_platform {
       default "";
       "~^:(ios|android|react-native|react-native-ios|react-native-android|flutter|flutter-ios|flutter-android|lynx-ios|lynx-android|capacitor|kotlin-multiplatform)$" $1;
   }

   server {
       server_name www.example.com;
       include /etc/nginx/snippets/fingerly.conf;
       # ...
   }
   ```

6. Check and reload: `sudo nginx -t && sudo systemctl reload nginx`. Without
   the njs module `nginx -t` fails on `js_import`, so nothing is served
   without the response allowlist.
7. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
     consent: 'granted', // only once the visitor has agreed, or you know none is needed (docs/privacy.md §4)
   })
   ```

`proxy_ssl_trusted_certificate` points at the usual system CA bundle; where
your system keeps it elsewhere, such as `/etc/pki/tls/certs/ca-bundle.crt`,
change the path. nginx resolves `api.fingerly.io` when it
loads the configuration, so a reload picks up address changes.

## Exactly one path

nginx picks the `location` on the cleaned path: after resolving dot segments
such as `/x/../k7x2qm4a`, merging doubled slashes and decoding characters such
as `%61`. The block therefore also compares the raw request target,
`$request_uri`, and answers `404` unless it is exactly the path, optionally
followed by a query string. No prefix, trailing slash, doubled slash, dot
segment or encoded character is forwarded, and the match is case-sensitive.

## How the visitor's address is trusted

The proxy sends `$remote_addr`, the address of the connection nginx accepted,
as `x-fingerly-client-ip`. Nothing the visitor sends can change it. When nginx
is reached directly, that is the visitor.

When nginx sits behind a load balancer or CDN, `$remote_addr` is the load
balancer. Tell the realip module which addresses to trust and which header they
write, in the `http` or `server` block:

```nginx
set_real_ip_from 10.0.0.0/8;          # your load balancer's addresses
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

With `real_ip_recursive on`, nginx walks `X-Forwarded-For` from the right and
takes the first address outside the trusted ranges, so entries a visitor adds
on the left are ignored. Never trust `0.0.0.0/0`.

## What it sends and relays

Upstream, to `https://api.fingerly.io/api/v1/ingest` only: `content-type`,
`x-api-key`, `idempotency-key`, `user-agent`, `sec-fetch-*` and `sec-ch-ua*`
when present, plus the `x-fingerly-*` headers the proxy sets itself (the proxy
key, the client address, `x-fingerly-origin` from `Origin` when present,
`x-fingerly-sdk-platform` when matched by the lowercase `$fingerly_platform`
map, which keeps it only for a request without `Origin` (one channel header
goes upstream, never both), `x-fingerly-host`, the user agent and
`x-fingerly-proxy-version: nginx/1.0.0`, which the dashboard shows per proxy).
Requests missing both `Origin` and a valid `X-Fingerly-SDK-Platform` answer
`400` (`missing_origin`) without synthesizing `x-fingerly-origin`.
`proxy_pass_request_headers off` makes this an allowlist: cookies,
`Authorization` and any `x-fingerly-*` header a visitor forges never leave your
server. Bodies over 1 MiB are refused with `413`, redirects are not followed,
and a key that is not shaped like a proxy key answers `503`. A request whose
`X-Api-Key` is missing or is not a `fly_pk_` key of the proxy key's
environment (a secret `fly_sk_` key included) answers `401` and is not
forwarded.

Back to the page: an API redirect (`3xx`), or any status outside `200` to
`599`, answers `502` marked `no-store` with none of its headers or body
(`fingerly.js` rewrites the status and replaces the body), so `Location` never
reaches the page. Any other answer: the API's status and body with only `content-type`,
`x-request-id`, `ratelimit-limit`, `ratelimit-remaining` and `retry-after`,
plus `Cache-Control: no-store`. `fingerly.js` removes every other upstream
header, so a header the API adds later never reaches the page. nginx adds its
own `Date`, framing headers and `Server: nginx`, without the version
(`server_tokens off`).

Other methods answer `405` with `Allow: POST`. If you prefer nginx's
`limit_except POST { deny all; }` over the `if` block, those requests answer
`403` instead; either is fine for the SDK, which only posts.
