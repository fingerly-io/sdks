# @fingerly/web-js

The Fingerly browser SDK (`0.3.0`, wire contract `v: 3`). Collects browser
signals in a single `<= 350 ms` pass, submits them in **1 RTT** to
`POST /api/v1/ingest`, and returns the server's `IdentifyResult` (`requestId`,
`visitorId`, `identifiable`, and optional `suspectScore` / `suspectLevel`).

```sh
npm install @fingerly/web-js@^0.3.0
```

**Not for apps.** Do not embed this SDK in an app's web view (iOS or macOS
`WKWebView`, Android `WebView`, Capacitor, Cordova, Ionic, React Native WebView,
Flutter WebView, Electron). When an embedded WebView is detected, this SDK skips
all device-fingerprinting collectors to preserve Apple DPLA §3.3.3(B) compliance,
runs only the non-identifying `EMBEDDED_SAFE_SOURCES` runtime/integrity subset,
and the server returns `visitorId: ""` under Option B. Use the native Fingerly
iOS or Android SDK (or the React Native, Flutter, or Lynx bridge) in apps; see
[docs/privacy.md §3.3](../../../docs/privacy.md).

Using a framework? The `0.3.0` bindings wrap this package:
[`@fingerly/react`](https://www.npmjs.com/package/@fingerly/react),
[`@fingerly/vue`](https://www.npmjs.com/package/@fingerly/vue),
[`@fingerly/next`](https://www.npmjs.com/package/@fingerly/next),
[`@fingerly/nuxt`](https://www.npmjs.com/package/@fingerly/nuxt),
[`@fingerly/svelte`](https://www.npmjs.com/package/@fingerly/svelte) and
[`@fingerly/angular`](https://www.npmjs.com/package/@fingerly/angular).

## Load once, identify in 1 RTT when it matters

```ts
import { load } from '@fingerly/web-js'

// A public SDK key from the dashboard, scoped to the origins you list.
const fingerly = await load({
  apiKey: 'fly_pk_production_…',
  incognitoDetection: 'standard', // default; pass 'extended' to opt into storage_durability timing
})

// Later, from your consent tool, or pass consent: 'granted' to load() if you
// already have consent or know none is required here (docs/privacy.md §4).
fingerly.setConsent('granted')

// When the visitor does something worth protecting: sign-up, login, checkout.
// The tag names this action; your backend checks it against the one it expects.
const { requestId } = await fingerly.identify({ tag: `login:${loginAttemptId}` })

// Forward the request ID; your backend verifies it and decides.
const { decision } = await (
  await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, requestId }),
  })
).json()
```

Loading collects nothing and sends nothing. Consent defaults to `'pending'`, and
`identify()` / `collect()` reject with a `ConsentError` until consent is
`'granted'`.

`identify()` executes a single-pass `v: 3` collection (`<= 350 ms` default
wall-clock budget) and posts once to `POST /api/v1/ingest`; there are no
multi-tier runs or follow-up sidecar requests. Under **Option B**,
`visitorId === ""` and `visitorIsNew === false` whenever `identifiable === false`,
when the report came from an embedded WebView, or when an unmatched Web report
is high-risk.

Everything about the score is decided on the server, under the weights you set:
`suspectLevel` (`'low' | 'medium' | 'high'`) and `suspectScore` are `null` when
unscored or hidden by `hide_client_score` on the SDK key; `null` is not a clean
result. They are a UI hint only: whoever controls the page controls every branch
in it, so never gate an action on them in the browser.

### Decide on your backend

The `requestId` the page sends is untrusted input until your backend has
verified it. Read the stored event with a secret key and run the checks
described in
[server-side verification](https://docs.fingerly.io/docs/server-side-verification):

```ts
// server (Node.js), never in the page
import { BlockList } from 'node:net'
import { Fingerly, FingerlyAPIError } from '@fingerly/node'

const fingerly = new Fingerly({ secretKey: process.env.FINGERLY_SECRET_KEY })
const MAX_AGE_MS = 2 * 60 * 1000

// expectedTag comes from your server session (`login:${loginAttemptId}` for
// the attempt your server issued), never from the request body. clientIp is
// the address of this post, as your framework resolves it.
export async function decide(requestId: string, expectedTag: string, clientIp: string) {
  let event
  try {
    event = await fingerly.events.get(requestId)                       // 1. it exists
  } catch (error) {
    if (error instanceof FingerlyAPIError && error.isPending) return 'retry'
    if (error instanceof FingerlyAPIError && error.code === 'event_not_found') return 'refuse'
    throw error
  }
  if (event.tag !== expectedTag) return 'refuse'                           // 2. this action
  if (Date.now() - Date.parse(event.occurred_at) > MAX_AGE_MS) return 'refuse' // 3. recent
  if (!event.identifiable || event.suspect_score === null) return 'refuse' // 4. identifiable and scored
  if (event.suspect_level === 'high') return 'review'                      // 5. your policy
  // 6. another network than this post: step up (for example a second factor)
  if (!event.ip_network || !inNetwork(clientIp, event.ip_network)) return 'challenge'
  if (event.suspect_level === 'medium') return 'challenge'
  return 'allow'
}

// ip_network is the /24 (IPv4) or /40 (IPv6) the identification came from;
// the API never returns the address itself.
function inNetwork(ip: string, cidr: string): boolean {
  const [base = '', bits = '0'] = cidr.split('/')
  const type = base.includes(':') ? 'ipv6' : 'ipv4'
  const list = new BlockList()
  list.addSubnet(base, Number(bits), type)
  return list.check(ip, type)
}
```

One event can back more than one decision inside the recency window; for a flow
that must be single use, record the `requestId` with the outcome and refuse one
you have already seen.

### Local collection without submitting (`collect()`)

To inspect the `SignalReport` locally (for example, on a debug page) without
sending a network request, call `collect()`:

```ts
const report = await fingerly.collect({ incognitoDetection: 'extended' })
```

`collect()` still requires `consent === 'granted'` and rejects with `ConsentError`
otherwise.

### Incognito detection (`'standard' | 'extended'`)

- `'standard'` (default): runs zero-write private-browsing probes (`storage` and
  `storage_quota`).
- `'extended'`: additionally runs `storage_durability` (Chromium IndexedDB
  relaxed-vs-strict durability commit timing) inside the single-pass budget. Can
  be set on `load({ incognitoDetection })` or overridden per `identify()` /
  `collect()` call.

### Zero permission prompts & Stage 1 Gecko RFP guard

The SDK never triggers a browser permission prompt, picker, or dialog. On Gecko
browsers (Firefox and Tor Browser), Stage 1 (`prerequisite`) runs `engine` and a
bounded `<= 3 ms` `performance.now()` clamping check (`timing`) as a barrier
before Stage 2 (`collect`) starts. When `resistFingerprinting` clock clamping is
detected, both `shields` and `canvas` skip `<canvas>` pixel readback (`blocked`
with reason `'rfp-canvas-prompt-avoided'`), guaranteeing zero Tor Browser or
Firefox RFP canvas permission doorhangers.

## Serve it from your own site

Content blockers refuse requests to third-party hosts and to paths they know.
Create a proxy in the dashboard (**Integration > Proxy keys**), mount it at the
path it issued with one of the server SDKs or proxy templates, and point the
SDK at that path:

```ts
const fingerly = await load({
  apiKey: 'fly_pk_production_…',
  endpoints: '/k7x2qm4a',
  consent: 'granted',
})
```

The path is used exactly as given, with nothing appended. An array of paths
or URLs is tried in order when one does not answer; pass
`fallbackToDefaultEndpoint: true` only if you want `https://api.fingerly.io`
tried after custom endpoints fail.

## Content Security Policy & `worker_realm`

With a first-party proxy, `connect-src 'self'` covers the proxy path, and the
script itself is your own bundle or `script-src 'self'` for the script-tag
build.

- **CSP-safe `worker_realm`:** To catch anti-detect extensions that patch
  `window.navigator` or WebGL in the document realm while leaving
  `DedicatedWorkerGlobalScope` untouched, `worker_realm` runs a short-lived
  `Blob` worker inside the collection budget, explicitly loses its temporary
  `OffscreenCanvas` WebGL context, terminates the worker, and revokes the
  `Blob` URL. If your policy disallows `blob:` workers, the attempt is refused
  once and the source reports `blocked`: `csp-meta` when an enforced
  `<meta http-equiv="Content-Security-Policy">` in `<head>` disallows them,
  `csp-blocked` when an HTTP header does. The refusal is remembered for the
  rest of the page session, so a strict policy produces at most one violation
  per page, never one per call. To let the check run, add `worker-src blob:`.
- **`'unsafe-eval'` is not needed:** no source evaluates a string as code, so a
  policy without `'unsafe-eval'` produces no violation report from the SDK.

Firefox prints a console deprecation warning when WebGL reads
`WEBGL_debug_renderer_info`; it comes from the browser, changes nothing for the
visitor, and is not an error.

## Errors

- `load()` never throws synchronously. Missing or backend-only keys (`fly_sk_`,
  `fly_px_`, `fly_mk_`) fail closed.
- `identify()` and `collect()` reject with `ConsentError` while consent is not
  `'granted'`.
- `identify()` rejects with `TransportError` when the submission cannot be
  completed. Branch on its `status` and `retryable`. When the server sends
  `Retry-After` on `429` or `503`, `retryAfterMs` carries the wait; waits up to
  two seconds are retried automatically under the same `Idempotency-Key` so a
  check is never billed twice.

## Without a bundler

The package (`0.3.0`) includes a minified IIFE script-tag build,
`dist/browser.global.js`, which defines a global `Fingerly`. Serve that file
from your own origin under a neutral path (for example copied from
`@fingerly/web-js@0.3.0/dist/browser.global.js`) and load it before your code:

```html
<script src="/assets/app-core-0.3.0.js"></script>
<script>
  Fingerly.load({ apiKey: 'fly_pk_production_…', consent: 'granted' })
    .then((fingerly) => fingerly.identify({ tag: 'login' }))
    .then((result) => console.log(result.requestId))
</script>
```

## Documentation

The full guide, including consent tools, first-party proxies and the server
side, is at [docs.fingerly.io](https://docs.fingerly.io/docs/sdks/javascript).

## Licence

Apache-2.0
