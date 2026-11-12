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
  (`https://api.fingerly.io`).
- `collect()`, the scheduler that runs sources under a budget, and the
  `Source` type with its helper errors.
- `isSuspiciousLevel()`, which reads the server's `suspectLevel` the same way in
  every binding: `true` for `medium` or `high`, `false` for `low`, `null` when
  absent.
- The shared types, including `FingerlyClientOptions`, `IdentifyOptions`,
  `IdentifyResult`, `ConsentState` and `SignalReport`.

`FingerlyClientOptions` takes `apiKey`, `endpoints`, `fallbackToDefaultEndpoint`,
`apiVersion`, `consent` (defaults to `pending`), `platform`, `sources`,
`integrity`, `embedding`, `schedule` and `transport`. Consent works as in the
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
