# @badele/next

Next.js integration. It wraps [`@badele/react`](../react/README.md) and adds
the three things that are actually about Next: where the configuration comes
from, where the client boundary sits, and how an identification reaches a
Server Action.

Requires Next **15 or newer** and React **19** (App Router or Pages Router).
Tested against Next 16.

```
pnpm add @badele/next
```

## Configure

```
# .env.local
NEXT_PUBLIC_BADELE_API_KEY=pk_live_…
```

`NEXT_PUBLIC_` is the right prefix and not a compromise. This is a **public**
SDK key, scoped to the origins you list against it, and it is meant to be
readable in the page — that scoping is what makes it safe. A **secret** key is
refused by the API whenever a request carries an `Origin`, so the mistake this
prefix invites cannot silently work.

## Add the provider

```tsx
// app/layout.tsx — still a Server Component
import { BadeleProvider } from '@badele/next'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <BadeleProvider>{children}</BadeleProvider>
      </body>
    </html>
  )
}
```

The package is marked `'use client'`, so the provider is a client boundary and
your layout does not have to become one. Pages Router is the same component in
`_app.tsx`.

Mounting it collects nothing. When to identify stays the page's decision.

## Identify

The hooks are `@badele/react`'s, re-exported so you install one package:

```tsx
'use client'
import { useIdentify, useVerdict } from '@badele/next'

export function Checkout() {
  const { identify, isSuspicious, isLoading } = useIdentify()
  const { matched } = useVerdict('incognito')
  …
}
```

`useIdentify({ immediate: true })` is safe in a Next app for the reason it is
safe anywhere: it runs in an effect, and effects do not run during a server
render. The page renders on the server, collects after hydration, and every
component that asks shares the one identification.

The full surface — `immediate`, `suspend`, `tag`, `refresh`, confidence floors
— is documented in the [React binding's README](../react/README.md).

## Carry it into a Server Action

A Server Action runs where the browser is not, so the identification has to
travel with the submission:

```tsx
// app/signup/page.tsx
import { BadeleRequestId } from '@badele/next'
import { signUp } from './actions'

export default function Page() {
  return (
    <form action={signUp}>
      <input name="email" />
      <BadeleRequestId />
      <button>Create account</button>
    </form>
  )
}
```

```ts
// app/signup/actions.ts
'use server'
import { readRequestId } from '@badele/next/server'

export async function signUp(formData: FormData) {
  const requestId = readRequestId(formData)
  // correlate the signup with the identification, or proceed without one
}
```

`<BadeleRequestId />` identifies on mount and renders a hidden field. It is in
the server-rendered HTML **empty** rather than absent, which is deliberate: a
form submitted before the SDK finished, or with JavaScript disabled, is a
normal event, and the server can tell it apart from a form that never carried a
field at all.

`readRequestId()` returns `null` for all of those cases rather than throwing —
what to do about an unidentified submission is a policy your server owns. It
also refuses anything that is not a short opaque token: the field arrives from
the page, which means it arrives from whoever is driving the browser, and a
server that joins or logs it unchecked is one hand-written `<input>` away from
storing what the visitor typed.

Both halves agree on the field name through one exported constant,
`REQUEST_ID_FIELD`. Pass `name` to `<BadeleRequestId />` and the same `name` to
`readRequestId()` if you need a different one.

## The two entries, and why

| Import | Runs | Contains |
| --- | --- | --- |
| `@badele/next` | the browser | provider, field, hooks — a `'use client'` module |
| `@badele/next/server` | the server | `readRequestId`, `REQUEST_ID_FIELD` — no React |

A Server Action that imported `readRequestId` from the main entry would get a
client reference rather than a function: the import succeeds and the call fails
at runtime, which is the worst way to learn about a boundary. Hence the split.

## What this deliberately does not do

**It does not proxy the API through a route handler.** Serving the SDK's
submissions from your own origin is a real technique — it survives filter lists
that block third-party endpoints — but a naive proxy makes every event arrive
from your server's address, and the address is what the IP enrichment,
datacenter and Tor checks are computed from. Doing it properly needs the API to
trust a forwarded address from your origin specifically, which is a decision
that belongs on the server rather than in a client package.

**It does not fetch the enriched event.** Reading a finished event server-side
is `@badele/node`'s job, and the route it would call does not exist yet.
