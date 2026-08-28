import type { ReactNode } from 'react'

import { BadeleProvider } from '@badele/next'

/**
 * The root layout, which is a Server Component and stays one.
 *
 * Two things worth demonstrating. `<BadeleProvider>` is the client boundary,
 * so nothing above it has to become one. And the key is read *here*, in a
 * Server Component, and passed down as a prop: a server render reads
 * `process.env` at runtime, so any variable works and none of it depends on
 * Next having inlined anything into a dependency's compiled output. It arrives
 * in the browser through the RSC payload, which is where a public SDK key was
 * always going to end up.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 24,
          background: '#0f1115',
          color: '#e6e8ee',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
        }}
      >
        {/*
          Submitting is off unless the environment turns it on, so the demo
          runs against nothing. Point it at a server - an endpoint and a key in
          .env.local, which is gitignored - and it produces a real requestId
          for the form below to carry.
        */}
        <BadeleProvider
          apiKey={process.env.BADELE_API_KEY ?? process.env.NEXT_PUBLIC_BADELE_API_KEY}
          {...(process.env.BADELE_ENDPOINT === undefined
            ? {}
            : { endpoint: process.env.BADELE_ENDPOINT })}
          submit={process.env.BADELE_SUBMIT === 'true'}
        >
          {children}
        </BadeleProvider>
      </body>
    </html>
  )
}
