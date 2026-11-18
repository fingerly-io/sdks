<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly for the browser</b><br>Recognise returning visitors and spot automation, tampering and abuse, with one call from the page.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fingerly/web-js"><img src="https://img.shields.io/npm/v/@fingerly/web-js?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@fingerly/web-js"><img src="https://img.shields.io/npm/dm/@fingerly/web-js?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/fingerly-io/sdks/blob/main/client/web/web-js/LICENSE"><img src="https://img.shields.io/npm/l/@fingerly/web-js?style=flat-square" alt="Apache-2.0 licence"></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/banner.webp" alt="Fingerly" width="100%"></p>

## What is this

`@fingerly/web-js` is the Fingerly browser SDK (`0.5.0`, wire contract `v: 3`).
It reads the signals a browser exposes in a single pass (`350 ms` by default),
sends them to Fingerly in one request, and returns the server's answer: a
`requestId`, a stable `visitorId`, whether the visitor is `identifiable`, and
an optional `suspectScore` and `suspectLevel`. With it you can recognise
returning visitors and spot automation, tampering and abuse.
[Fingerly](https://fingerly.io) helps you protect signups, logins and payments
from fraud and abuse.

Using a framework? The `0.5.0` bindings wrap this package and install it for you:
[`@fingerly/react`](https://www.npmjs.com/package/@fingerly/react),
[`@fingerly/vue`](https://www.npmjs.com/package/@fingerly/vue),
[`@fingerly/next`](https://www.npmjs.com/package/@fingerly/next),
[`@fingerly/nuxt`](https://www.npmjs.com/package/@fingerly/nuxt),
[`@fingerly/svelte`](https://www.npmjs.com/package/@fingerly/svelte) and
[`@fingerly/angular`](https://www.npmjs.com/package/@fingerly/angular).

> **Not for apps.** Do not embed this SDK in an app's web view (iOS or macOS
> `WKWebView`, Android `WebView`, Capacitor, Cordova, Ionic, React Native WebView,
> Flutter WebView, Electron). Inside an app's web view it runs only checks that
> identify no one, and the server returns `visitorId: ""`. Use the Fingerly iOS
> or Android SDK, or the React Native, Flutter or Lynx bridge, there. See
> section 3.3 of the
> [privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md).

## Getting started

1. **Get a key.** Create a public SDK key in the dashboard, scoped to the origins
   you list ([how keys work](https://docs.fingerly.io/docs/api-keys), and the
   [quick start](https://docs.fingerly.io/docs/quick-start)).
2. **Install.**

   ```sh
   npm install @fingerly/web-js
   # or: pnpm add @fingerly/web-js
   # or: yarn add @fingerly/web-js
   ```

3. **Load once, identify when it matters.**

   ```ts
   import { load } from '@fingerly/web-js'

   // A public SDK key from the dashboard. It is scoped to the origins you list,
   // which is what makes it safe to ship in the page.
   const fingerly = await load({ apiKey: 'fly_pk_production_…' })

   // Later, from your consent tool, or pass consent: 'granted' to load() if you
   // already have consent or know none is required here (see Consent below).
   fingerly.setConsent('granted')

   // When the visitor does something worth protecting: sign-up, login, checkout.
   // The tag names this action; your backend checks it against the one it expects.
   const { requestId } = await fingerly.identify({ tag: `login:${loginAttemptId}` })
   ```

4. **Decide on your backend.** Forward the request ID with the action, and let
   your backend verify it and decide (see
   [Decide on your backend](#decide-on-your-backend)):

   ```ts
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

`identify()` runs one collection pass (`350 ms` default wall-clock budget) and
posts once to `POST /api/v1/ingest`, with no follow-up requests. Each report
carries a single-use freshness ticket from the server, so a recorded report
cannot be replayed. The ticket for the next report comes back with each answer
and is held in memory only; when none is held, a small ticket request to the
same path runs in parallel with collection, and if it fails the report is sent
without a ticket. When the SDK key asks for proof of work, the SDK solves it in
a Worker (or in short time slices when the page's Content Security Policy
refuses `blob:` workers) within 1500 ms, starting as soon as the ticket arrives.

`visitorId` is `""` and `visitorIsNew` is `false` whenever `identifiable` is
`false`, when the report came from an app's web view, or when an unmatched web
report is high-risk.

## Contents

- [Reading the answer](#reading-the-answer)
- [Decide on your backend](#decide-on-your-backend)
- [Consent](#consent)
- [Incognito detection](#incognito-detection)
- [Session continuity](#session-continuity)
- [Serve it from your own site](#serve-it-from-your-own-site)
- [Options](#options)
- [Errors](#errors)
- [Content Security Policy](#content-security-policy)
- [Without a bundler](#without-a-bundler)
- [TypeScript](#typescript)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Help](#help)
- [Licence](#licence)

## Reading the answer

This package collects and sends. Everything about the score is decided on the
server, under the weights you set: `suspectLevel` (`'low' | 'medium' | 'high'`)
is the band, and it and `suspectScore` are `null` when absent (unscored, or
hidden by `hide_client_score` on the SDK key), which is not a clean result.
They are a UI hint only: whoever controls the page controls every branch in it,
so never gate an action on them in the browser.

Send `requestId` to your server and read the signals and the full result there
with a secret key (see the [server SDKs](https://docs.fingerly.io/docs/sdks)),
rather than trusting what the page reports: the page runs code the visitor
controls and is not told which signals fired.

## Decide on your backend

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

## Consent

Consent is `'pending'` (the default), `'granted'` or `'denied'`. Until it is
`granted` nothing is collected and nothing is sent, and `identify()` and
`collect()` reject with a `ConsentError` (`code: 'consent_required'`, with the
`state`). `pending` and `denied` behave the same.

- Pass `consent` to `load()`, or call `setConsent(state)` on the client when your
  consent tool reports the answer. It is synchronous, and setting the current
  value again does nothing.
- `onConsentChange(listener)` runs on a change and returns the unsubscribe; read
  `consent` for the current state.
- Withdrawing consent while a call is running stops it before it submits.
- Anything other than the three states throws a `TypeError`, so a consent tool's
  `'accepted'` or `true` is refused loudly instead of read as an answer.

Pass `granted` only once the visitor has agreed, or where you have established
that this visitor needs none. See section 4 of the
[privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md),
[privacy and consent](https://docs.fingerly.io/docs/privacy-and-consent) and
[consent tools](https://docs.fingerly.io/docs/consent-tools).

## Incognito detection

`incognitoDetection` takes `'standard'` or `'extended'`. Set it on `load()`, or
override it per `identify()` or `collect()` call.

- `'standard'` (the default) detects private browsing without writing anything.
- `'extended'` also runs an opt-in private-browsing check that writes to
  storage, inside the same single-pass budget.

In any mode the SDK never triggers a browser permission prompt, picker or
dialog, including in Firefox and Tor Browser with their strictest privacy
settings.

## Session continuity

`continuity` takes `'none'` or `'session'`. Set it on `load()`.

- `'none'` (the default) keeps nothing in the browser.
- `'session'` carries an identified private window across the reports of one
  tab. Each answer may carry a session seal, a signed token naming the visitor
  the server already answered with, and the SDK keeps it in `sessionStorage`
  under the single key `__fingerly_seal__` and sends it with the next report.

```ts
import { Continuity, load } from '@fingerly/web-js'

const fingerly = await load({
  apiKey: 'fly_pk_production_…',
  continuity: Continuity.Session,
})
```

The seal lives as long as the tab: it is accepted for 30 minutes, each answer
that honours it carries the next one, and a session ends 12 hours after it
began. It is never written to `localStorage`, a cookie, IndexedDB or
`window.name`.

- The seal is read and written only while consent is `granted`, and
  `setConsent('denied')` removes it at once.
- Where `sessionStorage` is unavailable or refuses access, `identify()` works
  as it does with `'none'`.
- Anything other than the two modes throws a `TypeError`.

Keeping the seal is storage access under ePrivacy Art. 5(3), covered by the
same consent as the rest of the SDK. See section 2.1 of the
[privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md).

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
or URLs is tried in order when one does not answer (a `404` or `405` moves on
to the next at once). Pass `fallbackToDefaultEndpoint: true` only if you want
`https://api.fingerly.io` tried after your custom endpoints fail.

Pair it with a server SDK that mounts the proxy: see
[proxy integrations](https://docs.fingerly.io/docs/proxy-integrations) and the
server SDK pages for
[Node](https://docs.fingerly.io/docs/sdks/node),
[Python](https://docs.fingerly.io/docs/sdks/python),
[Go](https://docs.fingerly.io/docs/sdks/go),
[Java](https://docs.fingerly.io/docs/sdks/java),
[.NET](https://docs.fingerly.io/docs/sdks/dotnet),
[PHP](https://docs.fingerly.io/docs/sdks/php),
[Ruby](https://docs.fingerly.io/docs/sdks/ruby),
[Rust](https://docs.fingerly.io/docs/sdks/rust) and
[Cloudflare Workers](https://docs.fingerly.io/docs/sdks/cloudflare-worker).

## Options

`load(options)` takes:

| Option | Type | Notes |
| --- | --- | --- |
| `apiKey` | `string` | Required. A public SDK key from the dashboard. |
| `endpoints` | `string \| string[]` | Ordered first-party ingestion URLs, posted to exactly as given: a root-relative path such as `/k7x2qm4a`, or an absolute URL. A bare origin such as `http://localhost:8099` is read as an API and gets the API's own path. No query or fragment. |
| `fallbackToDefaultEndpoint` | `boolean` | Try the Fingerly API after your custom endpoints fail, as a last resort. |
| `consent` | `'pending' \| 'granted' \| 'denied'` | Defaults to `pending`. |
| `incognitoDetection` | `'standard' \| 'extended'` | Defaults to `standard`. See [Incognito detection](#incognito-detection). |
| `continuity` | `'none' \| 'session'` | Defaults to `none`, which keeps nothing in the browser. See [Session continuity](#session-continuity). |
| `apiVersion` | `string` | API route version. Defaults to `v1`. |
| `schedule` | object | Overrides for the collection scheduler: `budgetMs` (default `350`), `defaultSourceTimeoutMs`, `concurrency`, `filter`, `signal`. |
| `transport` | `Transport` | Replaces the HTTP transport, for tests or a custom network stack. |
| `sources` | array | Replaces the source set, for tests or a caller with a reason to run a subset. |

`identify(options)` takes `tag` (echoed back on the finished event, for your
own correlation), `incognitoDetection` and `signal` (an `AbortSignal` that
cancels collection and submission).

`collect(options)` takes `incognitoDetection` and `signal`. It runs the
collection and returns the `SignalReport` without sending anything, for
example on a debug page:

```ts
const report = await fingerly.collect({ incognitoDetection: 'extended' })
```

Consent applies to `collect()` too: it rejects with `ConsentError` until consent
is `'granted'`.

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

`TransportError` also carries the server's error `code` when it sent one. The
two statuses worth branching on are `401` (the key is wrong, or was used from an
origin it does not list) and `402` (the organisation is not accepting traffic).
Both are your configuration rather than the visitor's. The full list is in the
[error reference](https://docs.fingerly.io/reference/errors).

## Content Security Policy

With a first-party proxy the SDK needs nothing beyond what your page already
allows: `connect-src 'self'` covers the proxy path, and the script itself is
your own bundle or `script-src 'self'` for the script-tag build.

- **`'unsafe-eval'` is not needed.** The SDK never evaluates a string as code,
  so a policy without `'unsafe-eval'` produces no violation report from it.
- **`blob:` workers are optional.** One check runs in a short-lived worker
  built from a `blob:` URL inside the collection budget. If your policy
  disallows `blob:` workers, the attempt is refused once and that check
  reports `blocked`; the refusal is remembered for the rest of the page
  session, so a strict policy produces at most one violation from it per page,
  never one per call. To let the check run, add `worker-src blob:`.
- **Proof of work.** When the SDK key asks for proof of work, the SDK solves it
  in a `blob:` worker too, and in short time slices on the page when the policy
  refuses one.

See [Content Security Policy](https://docs.fingerly.io/docs/content-security-policy).

Firefox prints a console deprecation warning while the SDK reads the graphics
renderer. It comes from the browser, changes nothing for the visitor, and is
not an error.

## Without a bundler

The package (`0.5.0`) includes a minified IIFE script-tag build,
`dist/browser.global.js`, which defines a global `Fingerly`. Serve that file
from your own origin under a neutral path (for example copied from
`@fingerly/web-js@0.5.0/dist/browser.global.js`) and load it before your code:

```html
<script src="/assets/app-core-0.5.0.js"></script>
<script>
  Fingerly.load({ apiKey: 'fly_pk_production_…', consent: 'granted' })
    .then((fingerly) => fingerly.identify({ tag: 'login' }))
    .then((result) => console.log(result.requestId))
</script>
```

## TypeScript

The package ships its own types (`dist/index.d.ts`), as ES modules and CommonJS.
It exports `FingerlyOptions` for `load()`, and re-exports the types you receive
so you do not need the kernel as a dependency: `IdentifyOptions`,
`CollectOptions`, `IdentifyResult`, `ConsentState`, `IncognitoDetection`,
`SuspectLevel`, `SignalReport`, `SignalOutcome`, `SignalStatus`,
`IntegrityReport`, `Lie` and `Confidence`. The values `FingerlyClient`,
`ConsentError`, `TransportError` and `isSuspiciousLevel` are exported too, so a
handler can branch with `instanceof`. The package is side-effect free, so a
bundler can tree shake what you do not import.

## Requirements

A browser that runs ES2020 with `fetch` and `AbortController`: every current
version of Chrome, Edge, Firefox and Safari. A public SDK key whose allowed
origins include your page. The SDK runs in a browser page only; see the note on
apps above.

## Documentation

The full guide, including consent tools, first-party proxies and the server
side, is at [docs.fingerly.io](https://docs.fingerly.io/docs/sdks/javascript).

## Help

Open an issue on [fingerly-io/sdks](https://github.com/fingerly-io/sdks/issues),
or write to [support@fingerly.io](mailto:support@fingerly.io). Security issues:
[security@fingerly.io](mailto:security@fingerly.io).

## Licence

[Apache-2.0](https://github.com/fingerly-io/sdks/blob/main/client/web/web-js/LICENSE). Fingerly is a product of Badele LLC.
