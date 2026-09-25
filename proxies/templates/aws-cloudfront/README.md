# Fingerly first-party proxy for AWS CloudFront

A CloudFront Function and a cache behavior for the distribution that already
serves your site. The behavior answers one path the Fingerly dashboard issued,
on your own domain, and sends only the browser SDK's submissions to the
Fingerly API as its origin. It is not an open proxy: the origin is
`api.fingerly.io`, the function rewrites every request to one URL on it, and
every other method is refused.

- `function.js`: the function (runtime `cloudfront-js-2.0`), associated with
  both the viewer request and the viewer response event of the behavior.
- `cloudformation.yaml`: the same function plus the parameter, origin and cache
  behavior to merge into your distribution's template.

## Steps

1. In the dashboard, open **Integration > Proxy keys**, create a proxy and copy
   the key it shows once. Note the path it issued, such as `/k7x2qm4a`.
2. Create the function: **CloudFront > Functions > Create function**, runtime
   `cloudfront-js-2.0`. Paste `function.js`, replace `/k7x2qm4a` in `PATH` with
   your path, save and publish.
3. Add an origin to your distribution: origin domain `api.fingerly.io`,
   protocol **HTTPS only**, and a custom header named `x-fingerly-proxy-key`
   whose value is the key. CloudFront always overwrites a viewer-sent header of
   that name, so a visitor cannot supply their own.
4. Add a cache behavior:
   - path pattern: your path, such as `/k7x2qm4a` (no wildcard)
   - origin: the one from step 3
   - viewer protocol policy: **HTTPS only**
   - allowed HTTP methods: **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**
   - cache policy: **CachingDisabled**
   - origin request policy: **AllViewerExceptHostHeader**
   - function associations: the function from step 2 on **Viewer request**
     and on **Viewer response**
5. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
     consent: 'granted', // only once the visitor has agreed, or you have another lawful basis
   })
   ```

With CloudFormation, merge `cloudformation.yaml` into your template instead and
pass the key as the `FingerlyProxyKey` parameter. It is `NoEcho`, so the key
stays out of the template and out of version control. Anyone allowed to read
the distribution's configuration can still read the origin header, so limit
`cloudfront:GetDistributionConfig` accordingly.

## How the visitor's address is trusted

The function sends `event.viewer.ip`, the address CloudFront accepted the
connection from, as `x-fingerly-client-ip`. It is not read from any header, so
the visitor cannot change it. Put nothing in front of CloudFront for this path:
behind another proxy, that address would be the proxy's.

## What it sends and relays

Upstream, to `https://api.fingerly.io/api/v1/ingest` only: the viewer's request
with every cookie, `Authorization` and any visitor-sent `x-fingerly-*` header
removed, plus the `x-fingerly-*` headers the function sets (the client
address, the page origin, the user agent and
`x-fingerly-proxy-version: aws-cloudfront/1.0.0`, which the dashboard shows per
proxy) and the proxy key from the origin's custom header. Other methods answer
`405` with `Allow: POST`.

CloudFront Functions cannot read request bodies, so the body passes through
unchanged and CloudFront's own request limits apply rather than a 1 MiB cap.
The API enforces its own limit. The key lives in the origin configuration, so
unlike the code templates there is no key check in the function. Without the
origin header the API refuses every call with `401 proxy_key_missing`, because
the function still sends the visitor headers and only a proxy key may. Add it
before routing traffic.

Back to the page: the viewer response event keeps only `content-type`,
`x-request-id`, `ratelimit-limit`, `ratelimit-remaining` and `retry-after`
(and the framing headers CloudFront manages), drops every cookie and sets
`cache-control: no-store`. CloudFront adds its own `Via` and `X-Cache` style
headers after the function runs; none of them names Fingerly. The API itself
sends nothing naming Fingerly to proxied callers, and the server tests that, so
the allowlist is defense in depth.
