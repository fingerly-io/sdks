# @fingerly/node

Server-side event reads, webhook verification, and a same-origin proxy. Node.js
18.16 or newer. No runtime dependencies. Version 0.1.0 is prepared for release;
the repository is private and the npm package has not been published.

```ts
import { load, FingerlyAPIError, FingerlyTimeoutError } from '@fingerly/node'

const fingerly = load({ secretKey: process.env.FINGERLY_SECRET_KEY!, timeoutMs: 5000 })
const page = await fingerly.events.list({ limit: 50, level: 'high' })
const event = await fingerly.events.get(page.rows[0]!.request_id)
```

Event reads require `fly_sk_{eu|us}_{production|staging|development}_…` keys.
The key selects the regional endpoint; `endpoint` overrides it for a local API.
Public, proxy, management, malformed and unsupported keys are rejected before
network access. Requests do not follow redirects. Existing `get` and `list`
operations perform one request. A request deadline includes receiving its JSON
body; both accept an `AbortSignal` (`list` through its options).

Identification returns before archival and warehouse insertion. To wait for a
newly identified event, explicitly opt in to bounded polling:

```ts
const event = await fingerly.events.waitFor(requestId, {
  timeoutMs: 10000,
  intervalMs: 250,
  signal: controller.signal,
})
```

Only a structured `404 event_not_found` is retried. Other HTTP and transport
errors fail immediately. A missing event at the deadline throws
`FingerlyTimeoutError` with `operation: 'event_wait'`. Request deadlines use
`operation: 'request'`. External cancellation preserves the caller's reason.
`FingerlyAPIError` provides `status`, optional `code`, `details`, and `requestId`.
The archived `document` and `deferred_signals` are included when available;
`suspect_score: null` means unscored, and must not be treated as zero.

## Verify a backend action

Read the event with a server-only key. Check that its tag matches your action,
that it is recent, that its environment is correct, and that it was scored.
Apply your own policy to the server's verdict. Do not authorize an action using
scores or visitor identifiers supplied by the browser. Tags correlate events;
they do not replace your application's authentication or replay protection.

## Webhooks

```ts
import { verifyWebhook } from '@fingerly/node'
const valid = verifyWebhook({
  secret: process.env.FINGERLY_WEBHOOK_SECRET!,
  payload: rawBody,
  timestamp: request.headers.get('x-fingerly-timestamp'),
  signature: request.headers.get('x-fingerly-signature'),
})
```

Verify the exact raw bytes before JSON parsing. Signatures cover the timestamp
and body. The default replay tolerance is 300 seconds; persist processed webhook
IDs to deduplicate deliveries. During signing-secret rotation, any matching
signature in the comma-separated header is accepted.

## Same-origin proxy

```ts
import { createProxy } from '@fingerly/node'
export const POST = createProxy({
  proxyKey: process.env.FINGERLY_PROXY_KEY!,
  prefix: '/api/fingerly',
  clientIp: request => request.headers.get('cf-connecting-ip')!,
})
```

Use that IP header only when your origin exclusively accepts trusted Cloudflare
traffic; otherwise provide the callback appropriate to your infrastructure.
The callback is required. Browser requests carry a public SDK key for the same
region and environment as the proxy key. The proxy sends both keys upstream and
forwards only identify/supplement paths and selected visitor metadata. It does
not forward customer cookies or authorization headers. Bodies are limited to
1 MiB by default and responses are marked `no-store`. `secretKey` remains a
deprecated proxy option; do not pass it together with `proxyKey`.

## Development and release preparation

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm contract:check
pnpm test:package
```

The vendored synthetic contract snapshot makes tests independent of sibling
repositories. To update it from the integration workspace, set
`FINGERLY_CONTRACT_DIR` to its `contract` directory and run `pnpm contract:sync`.
Generated files record source provenance and checks verify their hashes and
TypeScript output. Never put production secrets in fixtures.

`pnpm pack` builds a release artifact. CI checks package installation and both
ESM/CommonJS imports on Node 18, 22, and 24. Public npm publishing is intentionally
disabled until release authorization and registry setup are complete.
