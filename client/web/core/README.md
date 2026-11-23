<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly core</b><br>The platform-independent kernel of the Fingerly SDKs: scheduling, consent and transport.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fingerly/core"><img src="https://img.shields.io/npm/v/@fingerly/core?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@fingerly/core"><img src="https://img.shields.io/npm/dm/@fingerly/core?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/fingerly-io/sdks/blob/main/client/web/core/LICENSE"><img src="https://img.shields.io/npm/l/@fingerly/core?style=flat-square" alt="Apache-2.0 licence"></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/banner.webp" alt="Fingerly" width="100%"></p>

## What is this

`@fingerly/core` is the kernel the Fingerly SDKs are built on. It runs a set of
sources under a time budget, holds the consent state, and submits the report.
It has no sources of its own, and it decides nothing: scoring lives on the
server. [Fingerly](https://fingerly.io) helps you protect signups, logins and
payments from fraud and abuse.

**You almost certainly want something else.** Use
[`@fingerly/web-js`](https://www.npmjs.com/package/@fingerly/web-js) for the
browser, or one of the framework bindings built on it
([React](https://www.npmjs.com/package/@fingerly/react),
[Vue](https://www.npmjs.com/package/@fingerly/vue),
[Svelte](https://www.npmjs.com/package/@fingerly/svelte),
[Angular](https://www.npmjs.com/package/@fingerly/angular),
[Next.js](https://www.npmjs.com/package/@fingerly/next),
[Nuxt](https://www.npmjs.com/package/@fingerly/nuxt)). They install this
package for you.

## How it behaves

- **One pass, one request.** Sources run in a single pass under a time budget
  (`350 ms` by default, `DEFAULT_BUDGET_MS`), each with its own timeout, and
  the report goes out as one `v: 3` envelope to `POST /api/v1/ingest`, with
  idempotent retries and no follow-up requests.
- **Consent first.** Consent starts as `pending`. Nothing runs before it is
  `granted`, and withdrawing it aborts collection or submission in flight.
- **Incognito detection.** `incognitoDetection: 'standard'` (the default)
  writes nothing. `'extended'` also runs the opt-in probes that may write to
  storage. Chrome incognito (Chromium 152 and later) is detected only with
  `'extended'`.
- **In-app WebViews.** When the page runs inside an in-app WebView, only
  non-identifying sources run.
- **Unidentifiable visitors.** Whenever `identifiable` is `false`, `visitorId`
  is `""` and `visitorIsNew` is `false`.
- **Freshness ticket (web).** Each report carries a single-use `ticket` the
  server issued, so a recorded report cannot be replayed. The answer's
  `next_ticket` is held in memory for the next report; only when none is held
  (or it has 10 seconds or less left) does the SDK ask for one, on the same
  path as reports and in parallel with collection. A failed or slow ticket
  request never blocks or fails `identify()`: the report goes without one.
  Tickets are never written to storage. A custom `Transport` opts in by
  implementing `ticket()`.
- **Ticket proof of work.** When the SDK key asks for it, a ticket arrives with
  `pow_bits`, and the SDK finds the smallest decimal nonce `n` such that
  `SHA256(ticket + ":" + n)` starts with that many zero bits, sending it as
  `ticket_pow`. Solving starts as soon as the ticket arrives, runs in a Worker
  when the page allows one (in short time slices otherwise), and stops after
  1500 ms, in which case the report goes without `ticket_pow`.
- **Session continuity (web).** Off by default (`continuity: 'none'`): the
  client keeps nothing in the browser. With `continuity: 'session'` every
  report asks for a session seal, a signed token naming the visitor the server
  already answered with, and the client keeps the one the answer carries in
  `sessionStorage` under the single key `__fingerly_seal__` and sends it with
  the next report from the same tab. It is read and written only while consent
  is `granted`, removed when consent is set to `denied`, and removed when an
  answer carries no seal. Storage that is missing or throws never fails
  `identify()`.

## Getting started

Install it only when you are building a platform SDK on the kernel:

```sh
npm install @fingerly/core
# or: pnpm add @fingerly/core
# or: yarn add @fingerly/core
```

A client built from this package alone has nothing to collect, because the
sources are supplied by the platform SDK (`@fingerly/web-js` supplies the
browser set). For a working example, start from the
[browser SDK README](https://www.npmjs.com/package/@fingerly/web-js).

## What it exports

- `FingerlyClient`, the client every SDK wraps: `identify()`, `collect()`,
  `setConsent()`, `onConsentChange()` and the `consent` state.
- `ConsentError`, `HttpTransport` and `TransportError`, plus `DEFAULT_ENDPOINT`
  (`https://api.fingerly.io`) and `SEAL_STORAGE_KEY` (`__fingerly_seal__`).
- `collect()`, the scheduler that runs sources under a budget, and the
  `Source` type with its helper errors.
- `isSuspiciousLevel()`, which reads the server's `suspectLevel` the same way in
  every binding: `true` for `medium` or `high`, `false` for `low`, `null` when
  absent.
- The shared types, including `FingerlyClientOptions`, `IdentifyOptions`,
  `IdentifyResult`, `ConsentState` and `SignalReport`.

`FingerlyClientOptions` takes `apiKey`, `endpoints`, `fallbackToDefaultEndpoint`,
`apiVersion`, `consent` (defaults to `pending`), `platform`, `sources`,
`integrity`, `embedding`, `schedule`, `transport`, `incognitoDetection` and
`continuity` (`'none'` by default, or `'session'`). Consent works as in the
browser SDK: until it is `granted` nothing runs and nothing is sent, and
`identify()` and `collect()` reject with a `ConsentError`.

## TypeScript

The package ships its own types (`dist/index.d.ts`), as ES modules and CommonJS,
and is side-effect free.

## Requirements

Built for ES2020. The HTTP transport uses the global `fetch`, or the one you
inject as `fetchImpl` on `HttpTransport`.

## Documentation

[docs.fingerly.io](https://docs.fingerly.io/docs/sdks/javascript)

## Help

Open an issue on [fingerly-io/sdks](https://github.com/fingerly-io/sdks/issues),
or write to [support@fingerly.io](mailto:support@fingerly.io). Security issues:
[security@fingerly.io](mailto:security@fingerly.io).

## Licence

[Apache-2.0](https://github.com/fingerly-io/sdks/blob/main/client/web/core/LICENSE). Fingerly is a product of Badele LLC.
