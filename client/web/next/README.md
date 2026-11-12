# @fingerly/next

Next.js integration. It wraps [`@fingerly/react`](../react/README.md) and adds
the three things that are actually about Next: where the configuration comes
from, where the client boundary sits, and how an identification reaches a
Server Action.

Requires Next **15 or newer** and React **19** (App Router or Pages Router).
Tested against Next 16.

```
pnpm add @fingerly/next
```

**Not for apps.** This binding runs the browser SDK, which collects nothing
inside an app's web view (Capacitor, Cordova, Ionic, React Native WebView,
`WKWebView`, Android `WebView`, Electron). Use the Fingerly iOS or Android SDK
in an app; see [docs/privacy.md §3.3](../../../docs/privacy.md).

## Configure

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

## Add the provider

```tsx
// app/layout.tsx (still a Server Component)
import { FingerlyProvider } from '@fingerly/next'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {/* consent="granted" only once you have consent (or know none is required here; see docs/privacy.md §4) */}
        <FingerlyProvider apiKey={process.env.FINGERLY_API_KEY} consent="granted">
          {children}
        </FingerlyProvider>
      </body>
    </html>
  )
}
```

The package is marked `'use client'`, so the provider is a client boundary and
your layout does not have to become one. Pages Router is the same component in
`_app.tsx`.

Mounting it collects nothing. When to identify stays the page's decision.

Consent defaults to `pending`, and nothing is collected or sent until it is
`granted`. A site with a consent banner passes the banner's answer instead of
`"granted"`, as below.

### Waiting for consent

Consent defaults to `pending`. When identification needs the visitor's consent
first, pass `consent` with what your consent tool says now. It is a prop rather than an environment
variable, because it is the visitor's decision rather than the deployment's:

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
[React binding's README](../react/README.md#waiting-for-consent).

## Identify

The hooks are `@fingerly/react`'s, re-exported so you install one package:

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

The full surface (`immediate`, `suspend`, `tag`, `refresh`) is documented in
the [React binding's README](../react/README.md).

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
field at all.

`readRequestId()` returns `null` for all of those cases rather than throwing:
what to do about an unidentified submission is a policy your server owns. It
also refuses anything that is not a short opaque token: the field arrives from
the page, which means it arrives from whoever is driving the browser, and a
server that joins or logs it unchecked is one hand-written `<input>` away from
storing what the visitor typed.

Both halves agree on the field name through one exported constant,
`REQUEST_ID_FIELD`. Pass `name` to `<FingerlyRequestId />` and the same `name` to
`readRequestId()` if you need a different one.

## The two entries, and why

| Import | Runs | Contains |
| --- | --- | --- |
| `@fingerly/next` | the browser | provider, field, hooks (a `'use client'` module) |
| `@fingerly/next/server` | the server | `readRequestId`, `REQUEST_ID_FIELD` (no React) |

A Server Action that imported `readRequestId` from the main entry would get a
client reference rather than a function: the import succeeds and the call fails
at runtime, which is the worst way to learn about a boundary. Hence the split.

## Running the demo

`demo/` is a real Next application: a Server Component layout, a client page,
and a Server Action reading the field back:

```
pnpm --filter @fingerly/next demo   # http://localhost:4178
```

It collects and submits nothing until you give it somewhere to submit: put `FINGERLY_API_KEY`, `FINGERLY_ENDPOINT` and `FINGERLY_SUBMIT=true` in
`demo/.env.local` (gitignored), with a key whose allowed origins include the
port you are running it on. Then the identification produces a real
`requestId`, the hidden field carries it, and the action prints the one it
read.

Open it twice, in an ordinary window and a private one, and watch the incognito
card change.

## What this deliberately does not do

**It does not proxy the API itself.** Serving the SDK's submissions from your
own origin is what gets them past content blockers, and the proxy for it lives
in `@fingerly/node`, because it holds a server secret and has to forward the
visitor's real address rather than your server's. Create a proxy in the
dashboard, put it in the route file for the path it issued, and give the
provider `endpoints="/k7x2qm4a"`:

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

**It does not read events back.** It does not need to: `identify()` resolves
with the server's answer (`visitorId`, and `suspectScore` and `suspectLevel`
unless the key hides them), so there is nothing to fetch afterwards. Reading stored
events for reporting is `@fingerly/node`'s job.
