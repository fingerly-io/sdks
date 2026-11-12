<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly for Next.js</b><br>The React binding, with Next's configuration, client boundary and Server Action handling built in.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fingerly/next"><img src="https://img.shields.io/npm/v/@fingerly/next?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@fingerly/next"><img src="https://img.shields.io/npm/dm/@fingerly/next?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/fingerly-io/sdks/blob/main/client/web/next/LICENSE"><img src="https://img.shields.io/npm/l/@fingerly/next?style=flat-square" alt="Apache-2.0 licence"></a>
  <img src="https://img.shields.io/badge/next.js-15%2B-blue?style=flat-square" alt="Next.js 15 or newer">
</p>

<p align="center"><img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/banner.webp" alt="Fingerly" width="100%"></p>

## What is this

`@fingerly/next` is the Next.js integration. It wraps
[`@fingerly/react`](https://www.npmjs.com/package/@fingerly/react) and adds the
three things that are actually about Next: where the configuration comes from,
where the client boundary sits, and how an identification reaches a Server
Action. [Fingerly](https://fingerly.io) helps you protect signups, logins and
payments from fraud and abuse.

> **Not for apps.** This binding runs the browser SDK, which collects nothing
> inside an app's web view (Capacitor, Cordova, Ionic, React Native WebView,
> `WKWebView`, Android `WebView`, Electron). Use the Fingerly iOS or Android SDK
> in an app; see section 3.3 of the
> [privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md).

## Getting started

1. **Get a key.** Create a public SDK key in the dashboard
   ([how keys work](https://docs.fingerly.io/docs/api-keys)).
2. **Install.**

   ```sh
   npm install @fingerly/next
   # or: pnpm add @fingerly/next
   # or: yarn add @fingerly/next
   ```

3. **Add the provider, then identify.**

   ```tsx
   // app/layout.tsx (a Server Component)
   import { FingerlyProvider } from '@fingerly/next'

   export default function RootLayout({ children }: { children: React.ReactNode }) {
     return (
       <html>
         <body>
           {/* consent="granted" only once you have consent (or know none is required here; see Consent below) */}
           <FingerlyProvider apiKey={process.env.FINGERLY_API_KEY} consent="granted">
             {children}
           </FingerlyProvider>
         </body>
       </html>
     )
   }
   ```

   ```tsx
   'use client'
   import { useIdentify } from '@fingerly/next'

   export function Checkout() {
     const { identify, isSuspicious, suspectLevel, isLoading } = useIdentify()
     …
   }
   ```

The package is marked `'use client'`, so the provider is a client boundary and
your layout does not have to become one. Pages Router is the same component in
`_app.tsx`.

Mounting it collects nothing. When to identify stays the page's decision.

## Contents

- [Configure the key](#configure-the-key)
- [Identify](#identify)
- [Consent](#consent)
- [First-party endpoints](#first-party-endpoints)
- [Options](#options)
- [Carry it into a Server Action](#carry-it-into-a-server-action)
- [The two entries](#the-two-entries)
- [Errors](#errors)
- [What this does not do](#what-this-does-not-do)
- [More](#more)
- [TypeScript](#typescript)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Help](#help)
- [Licence](#licence)

## Configure the key

Read the key in a Server Component and pass it down:

```tsx
// app/layout.tsx (a Server Component)
<FingerlyProvider apiKey={process.env.FINGERLY_API_KEY}>{children}</FingerlyProvider>
```

That is the arrangement that always works, and it is worth understanding why
rather than copying. A server render reads `process.env` at runtime, so any
variable name will do (no `NEXT_PUBLIC_` prefix needed), and the value reaches
the browser through the RSC payload, which is where a public SDK key was
always going to end up.

The provider will also read `NEXT_PUBLIC_FINGERLY_API_KEY` and
`NEXT_PUBLIC_FINGERLY_ENDPOINTS` itself, but that path has a condition on it:
Next inlines `NEXT_PUBLIC_` variables **while compiling**, and it does not
compile your dependencies. In a published build the read survives as a
`process.env` lookup, and in a browser there is no `process`. The server
render finds the key, hydration does not, and identification fails (the page
keeps rendering, and the console says which variable to set). It works if
your app lists `@fingerly/next` in `transpilePackages`; the prop above needs no
such condition, which is why it is the documented route.

Either way the key is a **public** SDK key, scoped to the origins you list
against it. A **secret** key is refused by the API whenever a request carries
an `Origin`, so the mistake either route invites cannot silently work.

## Identify

The hooks are `@fingerly/react`'s, re-exported so you install one package
(`useIdentify`, `useFingerly`, `createFingerlyStore`):

```tsx
'use client'
import { useIdentify } from '@fingerly/next'

export function Checkout() {
  const { identify, isSuspicious, suspectLevel, isLoading } = useIdentify()
  …
}
```

`useIdentify({ immediate: true })` is safe in a Next app for the reason it is
safe anywhere: it runs in an effect, and effects do not run during a server
render. The page renders on the server, collects after hydration, and every
component that asks shares the one identification.

The full surface (`immediate`, `suspend`, `tag`, `refresh`, and everything you
get back) is documented in the
[React binding's README](https://github.com/fingerly-io/sdks/tree/main/client/web/react#readme).

## Consent

Consent defaults to `pending`, and nothing is collected or sent until it is
`granted`. A site with a consent banner passes the banner's answer instead of
`"granted"`. When identification needs the visitor's consent first, pass
`consent` with what your consent tool says now. It is a prop rather than an
environment variable, because it is the visitor's decision rather than the
deployment's:

```tsx
'use client'
<FingerlyProvider apiKey={apiKey} consent={accepted ? 'granted' : 'pending'}>{children}</FingerlyProvider>
```

- `consent`: `'pending'` (the default), `'granted'` or `'denied'`.
- `useFingerly().setConsent(state)`: sets it from a consent tool's callback. The
  client's own `setConsent()` does the same.

While it is not `granted` nothing is collected or sent,
`useIdentify({ immediate: true })` and `<FingerlyRequestId />` wait, and a
manual `identify()` fails with a `ConsentError`. Once it becomes `granted` the
waiting identification runs, once. The details are in the
[React binding's README](https://github.com/fingerly-io/sdks/tree/main/client/web/react#consent).

Pass `granted` only once you have consent, or know none is required here. See
section 4 of the
[privacy notes](https://github.com/fingerly-io/sdks/blob/main/docs/privacy.md),
[privacy and consent](https://docs.fingerly.io/docs/privacy-and-consent) and
[consent tools](https://docs.fingerly.io/docs/consent-tools).

## First-party endpoints

Serving the SDK's submissions from your own origin is what gets them past
content blockers. The proxy for it lives in `@fingerly/node`, because it holds a
server secret and has to forward the visitor's real address rather than your
server's. Create a proxy in the dashboard, put it in the route file for the path
it issued, and give the provider `endpoints="/k7x2qm4a"`:

```ts
// app/k7x2qm4a/route.ts
import { Fingerly } from '@fingerly/node'

// Built on the first request rather than at import, so `next build` does not
// need the proxy key.
let proxy: ((request: Request) => Promise<Response>) | undefined

export function POST(request: Request) {
  proxy ??= Fingerly.createProxy({
    proxyKey: process.env.FINGERLY_PROXY_KEY!,
    // The last X-Forwarded-For entry is the address your own server or load
    // balancer saw. Read a CDN's client-IP header instead only when traffic
    // can reach this app through that CDN alone.
    clientIp: (req) => req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '',
  })
  return proxy(request)
}
```

Pass the path as a string. An array works too, and is compared by its
contents, so `endpoints={['/k7x2qm4a']}` does not start a new identification
when the layout renders again.

`@fingerly/next/server` also re-exports the proxy factory from `@fingerly/node`
as `createFingerlyProxy` (with its `FingerlyProxyOptions` type). See
[proxy integrations](https://docs.fingerly.io/docs/proxy-integrations) and the
[Node SDK](https://docs.fingerly.io/docs/sdks/node).

## Options

`<FingerlyProvider>` props:

| Prop | Type | Notes |
| --- | --- | --- |
| `apiKey` | `string` | A public SDK key. Overrides `NEXT_PUBLIC_FINGERLY_API_KEY`. |
| `endpoints` | `string \| string[]` | Ordered first-party ingestion paths or URLs, compared by contents. Overrides `NEXT_PUBLIC_FINGERLY_ENDPOINTS`, which is a JSON array of strings. |
| `fallbackToDefaultEndpoint` | `boolean` | Opt into the Fingerly API after the custom endpoints fail. |
| `consent` | `'pending' \| 'granted' \| 'denied'` | Defaults to `pending`. Never read from the environment. |
| `submit` | `boolean` | `false` collects and scores without submitting anything. |
| `apiVersion` | `string` | API route version. Defaults to `v1`. |

`<FingerlyRequestId />` takes `name` (the field name) and `immediate` (on by
default). The remaining options are `@fingerly/react`'s.

## Carry it into a Server Action

A Server Action runs where the browser is not, so the identification has to
travel with the submission:

```tsx
// app/signup/page.tsx
import { FingerlyRequestId } from '@fingerly/next'
import { signUp } from './actions'

export default function Page() {
  return (
    <form action={signUp}>
      <input name="email" />
      <FingerlyRequestId />
      <button>Create account</button>
    </form>
  )
}
```

```ts
// app/signup/actions.ts
'use server'
import { readRequestId } from '@fingerly/next/server'

export async function signUp(formData: FormData) {
  const requestId = readRequestId(formData)
  // correlate the signup with the identification, or proceed without one
}
```

`<FingerlyRequestId />` identifies on mount and renders a hidden field. It is in
the server-rendered HTML **empty** rather than absent, which is deliberate: a
form submitted before the SDK finished, or with JavaScript disabled, is a
normal event, and the server can tell it apart from a form that never carried a
field at all. Turn `immediate` off in a form that identifies at submit time
instead.

`readRequestId()` returns `null` for all of those cases rather than throwing:
what to do about an unidentified submission is a policy your server owns. It
also refuses anything that is not a short opaque token (at most 128 characters
of letters, digits, `_` and `-`): the field arrives from the page, which means
it arrives from whoever is driving the browser, and a server that joins or logs
it unchecked is one hand-written `<input>` away from storing what the visitor
typed.

Both halves agree on the field name through one exported constant,
`REQUEST_ID_FIELD` (`fingerly_request_id`). Pass `name` to
`<FingerlyRequestId />` and the same `name` to `readRequestId()` if you need a
different one.

## The two entries

| Import | Runs | Contains |
| --- | --- | --- |
| `@fingerly/next` | the browser | provider, field, hooks (a `'use client'` module) |
| `@fingerly/next/server` | the server | `readRequestId`, `REQUEST_ID_FIELD`, `createFingerlyProxy` (no React) |

A Server Action that imported `readRequestId` from the main entry would get a
client reference rather than a function: the import succeeds and the call fails
at runtime, which is the worst way to learn about a boundary. Hence the split.

## Errors

The error types are `@fingerly/react`'s (`ConsentError`, `TransportError`,
`FingerlyServerError`), documented in the
[React binding's README](https://github.com/fingerly-io/sdks/tree/main/client/web/react#errors).
Two things are particular to this package:

- A missing key is reported once on the console and the page keeps rendering;
  `identify()` then fails with the SDK's own message about a missing key.
- A `NEXT_PUBLIC_FINGERLY_ENDPOINTS` that is not a non-empty JSON array of
  strings is reported once and ignored, rather than thrown from a render.

## What this does not do

**It does not proxy the API itself.** See [First-party endpoints](#first-party-endpoints):
the proxy comes from `@fingerly/node`.

**It does not read events back.** It does not need to: `identify()` resolves
with the server's answer (`visitorId`, and `suspectScore` and `suspectLevel`
unless the key hides them), so there is nothing to fetch afterwards. Reading stored
events for reporting is `@fingerly/node`'s job (see
[server-side verification](https://docs.fingerly.io/docs/server-side-verification)).

## More

<details>
<summary>Running the demo</summary>

`demo/` (in the
[repository](https://github.com/fingerly-io/sdks/tree/main/client/web/next)) is
a real Next application: a Server Component layout, a client page, and a Server
Action reading the field back:

```sh
pnpm --filter @fingerly/next demo   # http://localhost:4178
```

It collects and submits nothing until you give it somewhere to submit: put
`FINGERLY_API_KEY`, `FINGERLY_ENDPOINT` and `FINGERLY_SUBMIT=true` in
`demo/.env.local` (gitignored), with a key whose allowed origins include the
port you are running it on. Then the identification produces a real
`requestId`, the hidden field carries it, and the action prints the one it
read.

Open it twice, in an ordinary window and a private one, and watch the incognito
card change.

</details>

## TypeScript

Types ship with the package, for both entries. The main entry exports
`FingerlyNextProviderProps`, `FingerlyRequestIdProps`, `FingerlyReactOptions`,
`FingerlyState`, `FingerlyStore`, `UseIdentifyOptions`, `UseIdentifyReturn`,
`IdentifyResult`, `ConsentState`, `SignalReport` and `Confidence`, and the
values `ConsentError`, `TransportError`, `FingerlyServerError` and
`REQUEST_ID_FIELD`. `@fingerly/next/server` exports `readRequestId`,
`REQUEST_ID_FIELD`, `createFingerlyProxy` and `FingerlyProxyOptions`. Both
entries ship ES module and CommonJS builds.

## Requirements

Next **15 or newer** and React **19** (App Router or Pages Router). Tested
against Next 16. The browser SDK it wraps needs ES2020 with `fetch` and
`AbortController`: every current version of Chrome, Edge, Firefox and Safari.

## Documentation

The Next.js guide is at
[docs.fingerly.io](https://docs.fingerly.io/docs/sdks/nextjs). The React binding
underneath is [`@fingerly/react`](https://www.npmjs.com/package/@fingerly/react).

## Help

Open an issue on [fingerly-io/sdks](https://github.com/fingerly-io/sdks/issues),
or write to [support@fingerly.io](mailto:support@fingerly.io). Security issues:
[security@fingerly.io](mailto:security@fingerly.io).

## Licence

[Apache-2.0](https://github.com/fingerly-io/sdks/blob/main/client/web/next/LICENSE). Fingerly is a product of Badele LLC.
