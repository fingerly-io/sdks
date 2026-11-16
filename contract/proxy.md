# First-Party Proxy Relay Contract

This contract governs every first-party proxy relay. Two families implement it:

- **Edge proxies**: the Cloudflare Worker (`sdks/proxies/cloudflare`) and the 8 edge and reverse-proxy templates in `sdks/proxies/templates` (`aws-cloudfront`, `caddy`, `container`, `gcp-cloud-run`, `netlify`, `nginx`, `traefik`, `vercel`; Traefik routes to the `container` server).
- **SDK proxies**: the proxy handlers of the 8 Server SDKs (`sdks/server/{node,go,python,java,dotnet,ruby,rust,php}`), including their framework adapters (Java Jakarta, javax and WebFlux filters; ASP.NET Core middleware; PHP PSR-15, Laravel and Symfony adapters).

Every refusal a proxy writes itself carries `Cache-Control: no-store` and forwards nothing upstream.

---

## 1. Single-Path Raw-Byte Forwarding

1. **Exact path**: A proxy answers only its configured path (for example `/k7x2qm4a`, configured without a trailing slash). The match is on the raw request target and is case-sensitive: subpaths, trailing or doubled slashes, dot segments (`/k7x2qm4a/..`, `/x/../k7x2qm4a`), percent-encoded forms (`%2e%2e`) and sibling paths answer HTTP `404`. A query string after the exact path is accepted.
2. **Exact method**: Only `POST` is forwarded. The method is compared exactly as the runtime delivers it (methods are case-sensitive, RFC 9110), so an SDK proxy answers `post`, `Post` or `pOST` with HTTP `405`, just like `GET` or `PUT`. A `405` carries `Allow: POST`, or `Allow: POST, OPTIONS` when cross-origin origins are configured (section 4.4). `OPTIONS` is answered `204` only as a preflight from an allowed cross origin. Fetch-based runtimes (the Worker, Vercel, Netlify, and the Node SDK's `handle(Request)`) receive a method the Fetch standard has already uppercased; the Node SDK's Node-server handler passes the raw method, so `post` gets `405` there.
3. **Pinned upstream**:
   - Edge proxies forward to the constant `https://api.fingerly.io/api/v1/ingest`, never to a configured URL. The Worker alone honours `FINGERLY_DEV_UPSTREAM` for local testing: it is used only when it is a bare `http://` or `https://` origin on `localhost`, `127.0.0.1` or `[::1]` with no path; any other value is ignored and the constant is used.
   - SDK proxies take an optional `upstream` that must be a bare origin, `https://host` or `https://host:port`, with no path, query, fragment or credentials. Plain `http://` is accepted only for `127.0.0.1`, `localhost` or `[::1]`, and only when the dev flag is set: `allowInsecureLoopback` (Node, Java builder, .NET `AllowInsecureLoopback`, Go `ProxyOptions.AllowInsecureLoopback`) or `allow_insecure_loopback` (Python, Ruby, Rust builder, PHP). Any other value is a configuration error raised when the proxy is built. Requests go to `<upstream>/api/v1/ingest`.
   - Redirects are never followed. Fetch-based proxies send `redirect: "manual"`; the Java and .NET SDKs refuse an HTTP client or handler configured to follow redirects.
4. **Limits**: a `5s` deadline for the whole upstream exchange (`504` when it passes), a `1 MiB` (`1,048,576` bytes) request body cap (`413 Payload Too Large`, checked on the declared `Content-Length` and on the bytes read), and, wherever the proxy holds the answer (the Worker, Vercel, Netlify, container and Cloud Run templates and every SDK proxy), a `4 MiB` (`4,194,304` bytes) response cap (`502`). SDK proxies take the deadline and the request cap as options with these defaults. An unreachable upstream answers `502`.
5. **Zero body mutation**: Request body bytes are forwarded verbatim without JSON decoding, key re-ordering, whitespace normalization or float re-formatting. Mutating one byte of `signals` invalidates the native `v: 3` raw-byte attestation ([v3-envelope.md](./v3-envelope.md)) and the `SHA256(rawBody)[0:16]` idempotency check.

---

## 2. Sanitize-and-Restore Header Sequence

Every proxy builds the upstream header set from scratch (or produces the identical result), in this logical sequence:

1. **Capture validated `x-fingerly-sdk-platform`**: Read the incoming `x-fingerly-sdk-platform` header (case-insensitive name) and keep its value **if and only if** it matches exactly:
   ```regex
   ^(ios|android|react-native|react-native-ios|react-native-android|flutter|flutter-ios|flutter-android|lynx-ios|lynx-android|capacitor|kotlin-multiplatform)$
   ```
   Any other value (whitespace, uppercase, an unknown name, several values) counts as empty.
2. **Drop everything else the caller sent**: No incoming header crosses unless section 3.2 names it. Every incoming `x-fingerly-*` header, `Cookie`, `Authorization`, `Referer`, `Forwarded`, `X-Forwarded-*`, `X-Real-IP` and application headers are dropped. The caller's `Origin` header itself is never sent upstream; its value travels only as `X-Fingerly-Origin` (step 4).
3. **Origin gate (`400 missing_origin`)**: When both `Origin` and the validated platform are empty, answer HTTP `400` with `Content-Type: application/json` and a body `{"error":{"code":"missing_origin","message":"..."}}`. Clients read `code`; the message text differs between implementations. Browser `POST` requests carry `Origin`, native SDK HTTP stacks carry `X-Fingerly-SDK-Platform`, and a script call with neither is refused at the proxy.
4. **One channel header (Origin wins)**: Exactly one channel header goes upstream:
   - `Origin` present: `X-Fingerly-Origin` is set to its exact value and `X-Fingerly-SDK-Platform` is not sent, even when a valid platform was captured.
   - `Origin` absent: `X-Fingerly-SDK-Platform` is set to the validated platform.

   `X-Fingerly-Origin` is never synthesized from `Host`, `$scheme://$http_host`, `Referer` or the request URL. In the nginx template the `map` keeps the platform only for a request without `Origin`; in CloudFront the platform is restored only when `Origin` is absent.
5. **Inject proxy metadata** (section 3.1) and the allowlisted client headers (section 3.2).

### 2.1 Local Key Checks

Both checks run before anything is forwarded.

- **Proxy key**: The proxy's own key must match `^fly_px_(production|staging|development)_[A-Za-z0-9_-]+$`.
  - Edge proxies check the configured key on every request and answer HTTP `503` (`Cache-Control: no-store`) when it is missing or malformed. The CloudFront function never sees the key, which rides in the origin's custom header; it answers `503` when its environment sample is not a public key of a known environment.
  - SDK proxies treat a missing or malformed proxy key as a configuration error raised when the proxy is built. The Node SDK validates the key on the first request instead and answers HTTP `500` for every request until it is fixed, reporting it once per process.
- **Public key**: The caller's `X-Api-Key` must match `^fly_pk_<environment>_[A-Za-z0-9_-]+$`, where `<environment>` is the proxy key's environment. A missing header, a public key of another environment, a secret `fly_sk_` key or any other value is answered HTTP `401` (`Unauthorized`, `Content-Type: text/plain; charset=utf-8`, `Cache-Control: no-store`) by the proxy itself.

### 2.2 Check Order

A request that fails several checks gets the first refusal in its family's order:

| Family | Order |
|---|---|
| Worker, Vercel, Netlify, container, Cloud Run, nginx, Caddy | path `404`, (Worker: `403` for an `Origin` neither its own nor allowed), method `405`, proxy key `503`, `400 missing_origin`, public key `401`, then the client IP (`500`) and size (`413`) checks where the runtime makes them |
| CloudFront | path `404`, method `405`, `400 missing_origin`, environment `503`, public key `401`, client IP `500` |
| SDK proxies | path `404`, method `405`, (Node: proxy key `500`), public key `401`, `400 missing_origin`, then the client IP (`500`) and size (`413`) checks |

---

## 3. Upstream Request Header Specification

The upstream request carries only the headers in sections 3.1 and 3.2, plus transport framing (`Host`, `Content-Length`, `Connection`, `Accept-Encoding`, `Transfer-Encoding`). A header with an empty value is not sent.

### 3.1 Proxy-Injected Headers

| Upstream Wire Header | Contract Role | Value Rules |
|---|---|---|
| `X-Fingerly-Proxy-Key` | Proxy authentication credential | The proxy's `fly_px_<environment>_...` key (section 2.1). |
| `X-Fingerly-Client-IP` | Trusted visitor IP address | One IPv4 or IPv6 literal (no port, no IPv6 zone ID, no comma-separated list) from the platform's trusted socket or edge header. Anything else answers `500` and forwards nothing. |
| `X-Fingerly-Origin` | Browser page origin | The exact incoming `Origin` value when present (section 2, step 4). Never synthesized. |
| `X-Fingerly-SDK-Platform` | Native platform | The validated platform, only when `Origin` is absent (section 2, step 4). |
| `X-Fingerly-Host` | Proxy ingress host | The incoming `Host` observed at the proxy, distinct from the upstream `Host`. |
| `X-Fingerly-User-Agent` | Visitor user agent | The incoming `User-Agent`, so the server scores the visitor's agent rather than the proxy's HTTP client. |
| `X-Fingerly-Proxy-Version` | Proxy runtime telemetry | Static `<impl>/<version>` (for example `cloudflare-worker/0.3.0`, `nginx/1.0.0`, `node/0.3.0`). |

No proxy forwards details of the visitor's TLS or HTTP connection, such as the Worker's `request.cf.tlsVersion`, `request.cf.tlsCipher` or `request.cf.httpProtocol`. Current browsers and common scripting clients negotiate the same TLS 1.3 suites, so these values cannot tell them apart, and the values that stand out come mostly from TLS-inspecting middleboxes and older WebViews.

### 3.2 Forwarded Client Headers

Only these caller headers are forwarded, under the same name, when present:

| Incoming Client Header | Notes |
|---|---|
| `X-Api-Key` | The caller's public key, after the check in section 2.1. |
| `Content-Type` | `application/json` when absent. |
| `Idempotency-Key` | Verbatim; required by the `v: 3` ingest contract and bound into the native `framedPreimage` ([v3-envelope.md](./v3-envelope.md)). |
| `User-Agent` | Edge proxies forward the visitor's `User-Agent` as `User-Agent` too. SDK proxies send it only as `X-Fingerly-User-Agent`; their own `User-Agent` names the SDK's HTTP client. |
| `Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest` | Verbatim, for browser fetch-metadata and embedded-WebView checks. |
| `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` | Verbatim, for client-hint engine checks. |

---

## 4. Upstream Response Relay Rules

1. **Always set** `Cache-Control: no-store`, replacing any upstream `Cache-Control`.
2. **Response header allowlist**: relay only `Content-Type`, `X-Request-Id`, `RateLimit-Limit`, `RateLimit-Remaining` and `Retry-After` (needed for `409 request_in_progress` retry pacing), plus the CORS headers of section 4.4 and the framing headers the runtime manages. Nothing else crosses, whatever the API sends: not `Set-Cookie`, `Server` from upstream, `Location`, `Fingerly-Balance-Micros` or `Fingerly-RateLimit-Scope`.
3. **Statuses**:
   - Every proxy relays only a final answer of the pinned URL with a status in `200` to `599` outside `300` to `399`. A `3xx`, a status below `200` or above `599` (an opaque redirect has status `0`), a followed redirect or an answer from another URL is answered HTTP `502` with `Cache-Control: no-store`, and nothing of it is relayed: no header, no body, never its `Location`.
   - How each edge proxy does it: the Worker, Vercel, Netlify, container and Cloud Run templates check the status in code before reading the body; Traefik routes to the container server; Caddy answers those statuses with a `handle_response` matcher (`status 1xx 3xx 6xx 7xx 8xx 9xx`); nginx rewrites the status and replaces the body in `fingerly.js` (section 4.1).
   - CloudFront limit: its viewer response function turns such a status into `502` and drops every origin header, but a viewer response function cannot replace the body, so whatever body the origin sent with that answer still reaches the caller.
   - `204` and `205` are relayed without a body.
4. **Cross-origin CORS**, when the incoming `Origin` is in the configured list (Worker `FINGERLY_ALLOWED_ORIGINS`; SDK proxies `allowedOrigins` or the SDK's equivalent option). The other edge templates serve the page's own host and send no CORS headers.
   - `Access-Control-Allow-Origin: <matched_origin>` and `Vary: Origin`
   - `Access-Control-Allow-Methods: POST, OPTIONS`
   - `Access-Control-Allow-Headers: content-type, x-api-key, idempotency-key, x-fingerly-sdk-platform`
   - `Access-Control-Expose-Headers: x-request-id, ratelimit-limit, ratelimit-remaining, retry-after`

### 4.1 nginx Requires njs

Core nginx can only hide named upstream headers, not keep an allowlist. The nginx template therefore needs the njs module (`load_module modules/ngx_http_js_module.so;`): `fingerly.js` runs as the location's `js_header_filter` and deletes every response header outside the relay list (plus the pinned `Cache-Control`, `Allow` and framing headers). For a status that rule 3 refuses, the same filter sets the status to `502`, keeps only `Cache-Control` and sets `Content-Type: text/plain; charset=utf-8`; the `js_body_filter` then replaces the body with `Bad gateway` (the `js_var $fingerly_refused` flag links the two). Without njs the template's `js_import`, `js_var`, `js_header_filter` and `js_body_filter` directives do not load.

---

## 5. Server Proxied Native Routing

When the API receives a request with `X-Fingerly-Proxy-Key`:

- Both `X-Fingerly-Origin` and `X-Fingerly-SDK-Platform` empty: HTTP `401` (`code: "proxy_origin_missing"`).
- Both present: HTTP `401` (`code: "ambiguous_sdk_channel"`). Section 2, step 4 keeps a conforming proxy from sending both.
- `X-Fingerly-Origin` only: the browser proxy channel (`AuthenticateProxied`), validating `X-Fingerly-Origin` against the key's allowed origins.
- `X-Fingerly-SDK-Platform` only: the native channel (`AuthenticateProxiedNative`, `caller.Proxied = true`), reading the client IP from `X-Fingerly-Client-IP` without `X-Fingerly-Origin`. A web-only key (allowed origins and no native app configured) is refused on this channel in every environment.
