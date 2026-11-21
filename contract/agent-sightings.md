# Agent Sightings Contract

How a server SDK reports the requests a customer's server served, so that AI crawlers and fetchers
that never run a page's JavaScript are seen, and how it answers the customer from what the server
said. Every server SDK implements this identically. The endpoint is `POST /api/v1/agents/sightings`
(see `openapi.json`, schemas `AgentSightingsIn` and `AgentSightingsOut`, fixture `agent_sightings` in
`fixtures.json`).

## 1. The rule this contract keeps

The server decides; the SDK forwards raw input and remembers the server's answers. An SDK never
classifies a user agent, never checks an address against a list, never ships a list of agents, and
never filters requests by what the visitor claims to be. What it may decide is which of the
customer's own responses are worth reporting (section 2), because that is a fact about the
customer's resource, not about the visitor.

## 2. Which requests are reported

- By default, every request whose response the customer's server produced with a `Content-Type` of
  `text/html` or `application/xhtml+xml`, plus every request for the paths `/robots.txt`,
  `/llms.txt` and `/llms-full.txt`, whatever their status.
- The customer may widen or narrow this by path (include and exclude prefixes) and by response content
  type. Never by user agent, address or any request header.
- Static assets, API routes and health checks are not reported unless the customer includes them.
- The report is made after the response is produced and never delays it.

## 3. What is sent per request

| Field | Value |
|---|---|
| `user_agent` | The `User-Agent` header as received, or `""` when absent. A value over 4096 bytes is not reported at all (the request is answered `unknown`). |
| `client_ip` | One IPv4 or IPv6 literal from the same trusted client-IP source the SDK's proxy uses (`clientIp` callback or equivalent; never the left-most `X-Forwarded-For`). When it cannot be resolved, the request is not reported. |
| `host` | The `Host` the request was sent to, as received. |
| `method` | The request method, as received. |
| `signature`, `signature_input`, `signature_agent` | The three Web Bot Auth headers, when present. A header over 4096 bytes is left out. |
| `count` | How many times this exact request (section 4 key) was seen since it was last reported, this one included. |

Never sent: the path, the query string, cookies, `Authorization`, other headers, the body, the
response. The SDK does not log any of these fields.

## 4. The answer cache

### 4.1 Key

`key = lowercase hex of the first 16 bytes of SHA-256(user_agent || 0x00 || canonical_ip || 0x00 || signature_agent || 0x00 || signed)`

- Strings are UTF-8 bytes, exactly as received (no trimming, no case folding).
- `canonical_ip`: the address parsed and printed in its canonical text form; an IPv4-mapped IPv6
  address (`::ffff:a.b.c.d`) is printed as the IPv4 address; IPv6 follows RFC 5952 (lowercase,
  zeros compressed).
- `signature_agent` is the raw `Signature-Agent` header or `""`.
- `signed` is `1` when `Signature` and `Signature-Input` are both present, else `0`.
- `contract/agent-sightings-vectors.json` holds test vectors every SDK must reproduce.

### 4.2 Entries and bounds

- An entry holds the server's answer for one key and its expiry (`now + ttl`).
- A bounded LRU, per process. Default capacity 4096 entries, configurable, hard maximum 65536.
  Estimated cost a few hundred bytes per entry: about 1.5 MB at the default, about 25 MB at the
  maximum. Never unbounded, and never a cache shared across processes other than the PHP case in
  section 7.
- `ttl` comes from the server. `ttl: 0` is never cached (signed requests are checked every time).
- Every response carries `rules_version`. When it differs from the version the cache was filled
  under, the SDK drops every entry before storing the new answers.

### 4.3 Lookup

`lookup(request)` returns the cached answer for the request's key when it is present and unexpired,
and `unknown` otherwise. It never waits on the network and never throws. `unknown` is a named
constant, and the customer's code must treat it as "serve as usual" (fail open).

## 5. Buffering and flushing

- Pending reports are held in a bounded map keyed by the section 4 key: the first sighting's raw
  fields and a running `count`. A cache hit for a key increments that key's pending count (adding an
  entry when there is none), so the console counts requests the cache answered. Signed requests are
  never folded: each is its own item.
- A flush sends up to 200 items. It runs when the buffer reaches 200 items or 64 KiB, or 2 seconds
  after its oldest item. At most one flush is in flight per process.
- The buffer is capped at 1000 items. When it is full, a new key is not added (its request stays
  `unknown`) and the SDK counts the drop in a metric it exposes; existing keys keep counting.
- Deadline 5 seconds per flush. The flush never runs on, or blocks, a request the customer is
  serving.

## 6. Answers and failures

| Server answer | SDK behaviour |
|---|---|
| `200` | Store every answer with `ttl > 0` in the cache under its key; drop the sent items. |
| `422 invalid_request` | Drop the batch and log once per minute: it is an SDK bug, not a transient. |
| `429` with `Retry-After` | Keep the batch, stop flushing until `Retry-After` has passed (scope `daily` usually means until the next UTC day), keep counting into the bounded buffer. |
| `401` / `403` | Drop the batch, stop flushing for 60 seconds, log once: the key is wrong or revoked. |
| `503`, or a transport error before a response | Keep the batch and retry with exponential backoff from 1 second up to 60 seconds. |
| Timeout after the request was sent | Drop the batch: the server may have counted it, and a retry would count it twice. |

In every case, requests keep being served, and `lookup` keeps answering from the cache or `unknown`.

### 6.1 Details every SDK keeps alike

- `Retry-After` of `0`, negative, or unreadable: pause at least 1 second. Unreadable is treated as
  missing (scope `daily`: until the next UTC midnight; otherwise 60 seconds).
- `ttl` is clamped to at most 86400 seconds; `ttl <= 0` is never stored.
- A connection closed or reset, or a body cut short, once the request was fully written is treated
  like a timeout after sending: the batch is dropped, because the server may have counted it. Only
  where the SDK cannot tell whether the request was written is it kept and retried with backoff.
- An empty or whitespace-only `Signature`, `Signature-Input` or `Signature-Agent` header is absent,
  for the item and for the cache key.
- `flush()` waits at most 6 seconds for a flush already in flight (its 5-second deadline and a
  second of margin), and never raises.

## 7. Runtimes

- Long-lived processes run one background flusher: a timer that does not keep the process alive on
  its own (Node `unref`, a daemon thread or goroutine), restarted in a forked child (Python
  `os.register_at_fork`, Ruby on pid change). Each SDK exposes `flush()` and `close()`.
- Serverless and edge runtimes call `flush()` explicitly (for example in `waitUntil`) before the
  invocation ends.
- PHP-FPM keeps the cache and the buffer in APCu (bounded by the same counts), and the request that
  crosses a flush threshold flushes after `fastcgi_finish_request()` under an `apcu_add` lock. Without
  APCu, and without a long-running server such as Octane, RoadRunner or Swoole, the middleware does
  nothing and logs that once.

## 8. Answer fields

Each item of `AgentSightingsOut.items` is `{ttl, visitor_kind, agent?, ai?}`, with `ai` exactly as on
the event read. SDKs reuse their existing `VisitorKind`, `AIPurpose`, `AIRuntime`,
`AIVerificationMethod` and `AIVerificationResult` constants. The response carries nothing from the IP
database, by design.
