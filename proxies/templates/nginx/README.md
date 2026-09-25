# Fingerly first-party proxy for nginx

A `location` block for the nginx server that already serves your site. It
answers one path the Fingerly dashboard issued, on your own host, and forwards
only the browser SDK's submissions to the Fingerly API. It is not an open
proxy: the upstream is fixed in the configuration, and every other path and
method is refused.

## Steps

1. In the dashboard, open **Integration > Proxy keys**, create a proxy and copy
   the key it shows once. Note the path it issued, such as `/k7x2qm4a`.
2. Copy `fingerly.conf` to `/etc/nginx/snippets/fingerly.conf` and replace
   `/k7x2qm4a` with your path.
3. Put the key in its own file, readable only by root, and keep it out of
   version control:

   ```sh
   sudo install -m 600 -o root -g root /dev/null /etc/nginx/fingerly-proxy-key.conf
   echo 'set $fingerly_proxy_key "fly_px_production_...";' | sudo tee /etc/nginx/fingerly-proxy-key.conf >/dev/null
   ```

   If `/etc/nginx` is in a repository, add `fingerly-proxy-key.conf` to its
   `.gitignore`. `fingerly-proxy-key.conf.example` shows the format.
4. Include the snippet inside the `server` block for your site:

   ```nginx
   server {
       server_name www.example.com;
       include /etc/nginx/snippets/fingerly.conf;
       # ...
   }
   ```

5. Check and reload: `sudo nginx -t && sudo systemctl reload nginx`.
6. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
     consent: 'granted', // only once the visitor has agreed, or you have another lawful basis
   })
   ```

`proxy_ssl_trusted_certificate` points at the usual system CA bundle; where
your system keeps it elsewhere, such as `/etc/pki/tls/certs/ca-bundle.crt`,
change the path. nginx resolves `api.fingerly.io` when it
loads the configuration, so a reload picks up address changes.

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
`x-api-key`, `idempotency-key` when present, and the `x-fingerly-*` headers the
proxy sets itself (the proxy key, the client address, the page origin, the
user agent and `x-fingerly-proxy-version: nginx/1.0.0`, which the dashboard
shows per proxy). `proxy_pass_request_headers off` makes this an allowlist:
cookies, `Authorization` and any `x-fingerly-*` header a visitor forges never
leave your server. Bodies over 1 MiB are refused with `413`, redirects are not
followed, and a key that is not shaped like a proxy key answers `503`.

Back to the page: the API's status and body, with `Set-Cookie` dropped and
`Cache-Control: no-store`. The API itself sends nothing naming Fingerly to
proxied callers, and the server tests that, so dropping headers here is defense
in depth.

Other methods answer `405` with `Allow: POST`. If you prefer nginx's
`limit_except POST { deny all; }` over the `if` block, those requests answer
`403` instead; either is fine for the browser SDK, which only posts.
