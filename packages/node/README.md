# @fingerly/node

Use a secret SDK key only. This package reads stored events, verifies outbound
webhooks, and can proxy browser submissions through your own origin.

```ts
import { load, verifyWebhook } from '@fingerly/node'

const fingerly = load({ secretKey: process.env.FINGERLY_SECRET_KEY! })
const page = await fingerly.events.list({ limit: 50, level: 'high' })
const event = await fingerly.events.get(page.rows[0].request_id)

const valid = verifyWebhook({
  secret: process.env.FINGERLY_WEBHOOK_SECRET!,
  payload: rawBody,
  timestamp: request.headers.get('x-fingerly-timestamp'),
  signature: request.headers.get('x-fingerly-signature'),
})
```

The point read includes the archived original document and deferred signals
when those objects are available.

For a same-origin browser endpoint, use `createProxy`. `clientIp` is required
on purpose: resolve it from the header written by infrastructure you actually
trust, never from the left-most forwarded value supplied by the public request.

```ts
import { createProxy } from '@fingerly/node'

export const POST = createProxy({
  secretKey: process.env.FINGERLY_SECRET_KEY!,
  prefix: '/api/fingerly',
  clientIp: (request) => request.headers.get('cf-connecting-ip')!,
})
```

Configure the browser SDK with `endpoint: '/api/fingerly'`. The proxy forwards
only identify and deferred-supplement paths. The API accepts visitor metadata
headers only from authenticated secret keys, so public SDK keys cannot spoof
them.
