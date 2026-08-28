'use client'

/**
 * The provider, configured the way a Next app configures things.
 */

import { BadeleProvider as ReactBadeleProvider } from '@badele/react'
import type { ReactNode } from 'react'

/**
 * Ambient rather than `@types/node`.
 *
 * This package runs in a browser as well as in a server render, and pulling
 * Node's global types into it to read two strings would put `Buffer` and
 * `setImmediate` in scope for code that must not use them.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined

export interface BadeleNextProviderProps {
  /** Overrides `NEXT_PUBLIC_BADELE_API_KEY`. */
  apiKey?: string
  /** Overrides `NEXT_PUBLIC_BADELE_ENDPOINT`. Defaults to production. */
  endpoint?: string
  /** Collect and score without submitting anything. */
  submit?: boolean
  children?: ReactNode
}

/**
 * Read the public configuration Next inlines at build time.
 *
 * The member expressions are written out in full deliberately. Next replaces
 * `process.env.NEXT_PUBLIC_…` textually while bundling, so a dynamic
 * `process.env[name]` reads as `undefined` in the browser - the sort of bug
 * that works locally, where the server render finds a real `process`, and is
 * empty in production the moment hydration takes over.
 */
function fromEnvironment(): { apiKey?: string; endpoint?: string } {
  const environment = typeof process === 'undefined' ? undefined : process?.env
  if (!environment) return {}

  return {
    ...(environment.NEXT_PUBLIC_BADELE_API_KEY === undefined
      ? {}
      : { apiKey: environment.NEXT_PUBLIC_BADELE_API_KEY }),
    ...(environment.NEXT_PUBLIC_BADELE_ENDPOINT === undefined
      ? {}
      : { endpoint: environment.NEXT_PUBLIC_BADELE_ENDPOINT }),
  }
}

/**
 * Make the client available to every component below, in either router.
 *
 * ```tsx
 * // app/layout.tsx - a Server Component, which is the point: this is a
 * // client boundary and nothing above it has to become one.
 * export default function RootLayout({ children }) {
 *   return (
 *     <html><body>
 *       <BadeleProvider>{children}</BadeleProvider>
 *     </body></html>
 *   )
 * }
 * ```
 *
 * The key comes from `NEXT_PUBLIC_BADELE_API_KEY` unless a prop overrides it.
 * `NEXT_PUBLIC_` is the right prefix and not a compromise: this is a public
 * SDK key, scoped to the origins listed against it, and it is *meant* to be
 * readable in the page. A secret key is refused by the API whenever a request
 * carries an `Origin`, so the mistake this prefix invites cannot silently work.
 *
 * Nothing is collected on mount. When to identify stays the page's decision.
 */
export function BadeleProvider(props: BadeleNextProviderProps): ReactNode {
  const environment = fromEnvironment()
  const apiKey = props.apiKey ?? environment.apiKey
  const endpoint = props.endpoint ?? environment.endpoint

  if (!apiKey) {
    throw new Error(
      'No Badele key. Set NEXT_PUBLIC_BADELE_API_KEY in .env.local, or pass one:\n\n' +
        "  <BadeleProvider apiKey='pk_live_…'>\n\n" +
        'It must carry the NEXT_PUBLIC_ prefix - Next only exposes those to the browser, ' +
        'and this key is read there.',
    )
  }

  return (
    <ReactBadeleProvider
      apiKey={apiKey}
      {...(endpoint === undefined ? {} : { endpoint })}
      {...(props.submit === undefined ? {} : { submit: props.submit })}
    >
      {props.children}
    </ReactBadeleProvider>
  )
}
