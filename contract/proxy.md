# First-Party Proxy Relay Contract (`CA-06`, `F-10`)

This contract governs all 17 first-party proxy relay implementations: the Cloudflare Worker (`sdks/proxies/cloudflare`), the 8 edge and reverse-proxy templates (`sdks/proxies/templates/*`, where Traefik routes to `container/server.mjs`), and the 8 Server SDK proxy middlewares (`sdks/server/{node,go,python,java,dotnet,ruby,rust,php}`).

---

## 1. Single-Path Raw-Byte Forwarding

1. **Exact Path Matching**: A proxy answers only its configured path (for example `/k7x2qm4a`, normalized without trailing slashes). Subpaths, dot-segment traversals (`/k7x2qm4a/..`, `%2e%2e`), and sibling paths return HTTP `404` (`Cache-Control: no-store`). Only `POST` (and `OPTIONS` when cross-origin CORS is explicitly configured) is accepted; all other methods return HTTP `405` (`Allow: POST` or `Allow: POST, OPTIONS`, `Cache-Control: no-store`).
2. **Pinned Upstream Target**: Every accepted `POST` forwards exclusively to `https://api.fingerly.io/api/v1/ingest` (or a loopback-only dev override in test harnesses), with `redirect: "manual"`, a `5s` upstream deadline, a `1 MiB` (`1,048,576` bytes) request body cap (`413 Payload Too Large`), and a `4 MiB` (`4,194,304` bytes) response body cap (`502 Bad Gateway`).
3. **Zero Body Mutation**: Request body bytes are forwarded verbatim without JSON decoding, key re-ordering, whitespace normalization, or float re-formatting. Mutating even one byte of `signals` invalidates mobile `v: 3` raw-byte hardware signatures ([v3-envelope.md](./v3-envelope.md)) and `Gate` `SHA256(rawBody)[0:16]` idempotency checks.

---

## 2. Sanitize-and-Restore Header Sequence

Every proxy implementation must process incoming headers in this exact logical sequence (or construct a clean outgoing header map from scratch that produces the identical result):

1. **Capture Validated `x-fingerly-sdk-platform`**:
   Read the incoming `x-fingerly-sdk-platform` header (case-insensitive header name) and retain its value **if and only if** it matches the exact lowercase pattern:
   ```regex
   ^(ios|android|react-native|flutter|capacitor|kotlin-multiplatform)$
   ```
   Any non-matching value (whitespace, uppercase, unknown string, or multiple comma-separated values) is discarded as empty (`""`).
2. **Strip All Incoming `x-fingerly-*` Headers**:
   Remove every incoming header whose lowercased name starts with `x-fingerly-` (alongside `Cookie` and `Authorization`, which are never forwarded). Callers must never be able to smuggle `x-fingerly-proxy-key` (`X-Fingerly-Key`), `x-fingerly-client-ip` (`X-Fingerly-Forwarded-For`), `x-fingerly-origin`, `x-fingerly-host`, `x-fingerly-edge-tls-*`, or an unvalidated `x-fingerly-sdk-platform` through the proxy.
3. **Restore Validated `x-fingerly-sdk-platform`**:
   If Step 1 captured a valid platform identifier, set `X-Fingerly-SDK-Platform` to that validated value on the upstream request.
4. **Enforce the Origin / Native-Platform Gate (`400 missing_origin`)**:
   Inspect the incoming `Origin` header and the validated `x-fingerly-sdk-platform` from Step 1:
   - Reject immediately with HTTP `400` (`missing_origin`, `Cache-Control: no-store`) **if and only if both** `Origin` and validated `x-fingerly-sdk-platform` are empty.
   - **Never synthesize `X-Fingerly-Origin`** from `Host`, `$scheme://$http_host`, `Referer`, or `request.url`. Browser `POST` requests carry `Origin`; native SDK HTTP stacks carry `X-Fingerly-SDK-Platform`; raw `curl` or script calls without either are rejected at the proxy edge before consuming upstream resources.
5. **Inject Proxy Metadata and Forward Allowlisted Client Headers**:
   Construct the upstream request headers using only verified proxy metadata and the explicit client header allowlist below.

---

## 3. Upstream Request Header Specification

### 3.1 Proxy-Injected Headers

| Upstream Wire Header | Contract Role | Value Rules |
|---|---|---|
| `X-Fingerly-Proxy-Key` (`X-Fingerly-Key`) | Proxy authentication credential | Secret `fly_px_<environment>_...` key held by the proxy. Missing or malformed proxy configuration fails closed (`500`/`503`) without calling upstream. |
| `X-Fingerly-Client-IP` (`X-Fingerly-Forwarded-For`) | Trusted visitor IP address | Single validated IPv4 or IPv6 literal (no port, no IPv6 zone ID, no comma-separated XFF list) extracted from the platform's trusted edge socket/header. |
| `X-Fingerly-Origin` | Browser page origin | Exact incoming `Origin` header when present. Omitted (not synthesized) when `Origin` is absent on validated `X-Fingerly-SDK-Platform` requests. |
| `X-Fingerly-Host` | Proxy ingress host | Incoming `Host` header observed at the customer proxy edge (when available), distinct from the upstream `Host: api.fingerly.io` target. |
| `X-Fingerly-SDK-Platform` | Restored native platform | Set only when Step 1 matched `^(ios|android|react-native|flutter|capacitor|kotlin-multiplatform)$`. |
| `X-Fingerly-Proxy-Version` | Proxy runtime telemetry | Static `<impl>/<version>` identifier (for example `cloudflare-worker/0.3.0`, `nginx/1.0.0`, `node/0.3.0`). |
| `X-Fingerly-Edge-TLS-Version` (`X-Fingerly-Edge-TLS-*`) | Edge TLS protocol | Terminated visitor TLS version (for example `TLSv1.3`) injected by edge runtimes that expose TLS metadata (such as Cloudflare Workers `request.cf.tlsVersion`). |
| `X-Fingerly-Edge-TLS-Cipher` (`X-Fingerly-Edge-TLS-*`) | Edge TLS cipher suite | Terminated visitor TLS cipher (for example `AEAD-AES128-GCM-SHA256`) injected by edge runtimes (`request.cf.tlsCipher`). |
| `X-Fingerly-Edge-HTTP-Proto` (`X-Fingerly-Edge-TLS-*`) | Edge HTTP protocol | Terminated visitor HTTP protocol (for example `HTTP/2`, `HTTP/3`) injected by edge runtimes (`request.cf.httpProtocol`). |

### 3.2 Forwarded Client Headers

Only the following caller headers are forwarded upstream when present on the incoming request:

| Incoming Client Header | Upstream Header | Notes |
|---|---|---|
| `X-Api-Key` | `X-Api-Key` | Required client publishable key (`fly_pk_<environment>_...`); missing or environment-mismatched keys return HTTP `401` locally before upstream fetch. |
| `Content-Type` | `Content-Type` | Defaults to `application/json` if absent. |
| `Idempotency-Key` | `Idempotency-Key` | Forwarded verbatim; required by the `v: 3` ingest contract ([v3-envelope.md](./v3-envelope.md)) and bound into native `framedPreimage`. |
| `User-Agent` | `X-Fingerly-User-Agent` / `User-Agent` | Forwarded verbatim so the server scores the visitor's `User-Agent` rather than the proxy runtime's HTTP client string. |
| `Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest` (`Sec-Fetch-*`) | Same header names | Forwarded verbatim when present for browser fetch-metadata and embedded-WebView consistency checks. |
| `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` (`Sec-CH-UA-*`) | Same header names | Forwarded verbatim when present for client-hint engine consistency checks. |

---

## 4. Upstream Response Relay Rules

To prevent content blockers from fingerprinting Fingerly-specific headers and to avoid leaking internal billing state:

1. **Always Set**: `Cache-Control: no-store`.
2. **Response Header Allowlist**: Relay **only** `Content-Type`, `X-Request-Id`, `RateLimit-Limit`, `RateLimit-Remaining`, and `Retry-After` (required for `409 request_in_progress` client retry pacing).
3. **Never Relay**: `Set-Cookie`, `Server`, `Fingerly-Balance-Micros`, `Fingerly-RateLimit-Scope`, or any upstream `Cache-Control` directive.
4. **Cross-Origin CORS (when `FINGERLY_ALLOWED_ORIGINS` matches incoming `Origin`)**:
   - `Access-Control-Allow-Origin: <matched_origin>` and `Vary: Origin`
   - `Access-Control-Allow-Methods: POST, OPTIONS`
   - `Access-Control-Allow-Headers: content-type, x-api-key, idempotency-key, x-fingerly-sdk-platform`
   - `Access-Control-Expose-Headers: x-request-id, ratelimit-limit, ratelimit-remaining, retry-after`

---

## 5. Server Proxied Native Routing

When the Go server receives an authenticated proxy request (`X-Fingerly-Proxy-Key` valid):

- If `X-Fingerly-Origin` is non-empty, the request authenticates on the browser proxy channel (`AuthenticateProxied`), validating `X-Fingerly-Origin` against the key's allowed origins.
- If `X-Fingerly-Origin` is empty and `X-Fingerly-SDK-Platform` matches an allowed native/bridge platform, the request routes through `AuthenticateNative` with `caller.Proxied = true` (extracting client IP from `X-Fingerly-Client-IP` without requiring `X-Fingerly-Origin`), and rejects web-only keys (`len(AllowedOrigins) > 0` with no native app configuration) across all environments.
- If both `X-Fingerly-Origin` and `X-Fingerly-SDK-Platform` are empty on a proxied request, the server rejects with HTTP `401` (`code: "proxy_origin_missing"`).
