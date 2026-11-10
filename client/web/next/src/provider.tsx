'use client'

/**
 * The provider, configured the way a Next app configures things.
 */

import { FingerlyProvider as ReactFingerlyProvider, type ConsentState } from '@fingerly/react'
import type { ReactNode } from 'react'

/**
 * Ambient rather than `@types/node`.
 *
 * This package runs in a browser as well as in a server render, and pulling
 * Node's global types into it to read two strings would put `Buffer` and
 * `setImmediate` in scope for code that must not use them.
 */
declare const process: { env: Record<string, string | undefined> } | undefined

export interface FingerlyNextProviderProps {
  /** Overrides `NEXT_PUBLIC_FINGERLY_API_KEY`. */
  apiKey?: string
  /** API route version. Defaults to v1. */
  apiVersion?: string
  /** Ordered first-party endpoints; overrides NEXT_PUBLIC_FINGERLY_ENDPOINTS. */
  endpoints?: string | readonly string[]
  /** Opt into the Fingerly API after custom endpoints fail. */
  fallbackToDefaultEndpoint?: boolean
  /** Collect and score without submitting anything. */
  submit?: boolean
  /**
   * Whether the visitor has agreed to be identified. Defaults to `pending`.
   *
   * Read as the current answer: pass what the consent tool says now, and a
   * change to `granted` starts any automatic identification that was waiting.
   * Deliberately not read from the environment, because it is the visitor's
   * decision rather than the deployment's.
   */
  consent?: ConsentState
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
function fromEnvironment(): { apiKey?: string; endpoints?: string[] } {
  // Written out in full, twice, and not hoisted into a variable. Next replaces
  // the *exact* member expression `process.env.NEXT_PUBLIC_…` while bundling;
  // `const env = process.env` followed by `env.NEXT_PUBLIC_…` is a dynamic
  // property access it cannot see, which survives the build and reads
  // undefined in a browser where there is no `process` at all.
  //
  // That is not hypothetical - it is what the first version of this file did.
  // The server render found the key (a real `process.env` lives there) and
  // hydration threw "No Fingerly key", so the page rendered and then died.
  const apiKey =
    typeof process === 'undefined' ? undefined : process.env.NEXT_PUBLIC_FINGERLY_API_KEY
  const endpointsRaw =
    typeof process === 'undefined' ? undefined : process.env.NEXT_PUBLIC_FINGERLY_ENDPOINTS
  const endpoints = endpointsRaw ? parsedEndpoints(endpointsRaw) : undefined

  return {
    ...(apiKey === undefined || apiKey === '' ? {} : { apiKey }),
    ...(endpoints === undefined ? {} : { endpoints }),
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
 *       <FingerlyProvider>{children}</FingerlyProvider>
 *     </body></html>
 *   )
 * }
 * ```
 *
 * The key comes from `NEXT_PUBLIC_FINGERLY_API_KEY` unless a prop overrides it.
 * `NEXT_PUBLIC_` is the right prefix and not a compromise: this is a public
 * SDK key, scoped to the origins listed against it, and it is *meant* to be
 * readable in the page. A secret key is refused by the API whenever a request
 * carries an `Origin`, so the mistake this prefix invites cannot silently work.
 *
 * Nothing is collected on mount. When to identify stays the page's decision.
 */
/**
 * NEXT_PUBLIC_FINGERLY_ENDPOINTS, parsed once per value.
 *
 * Parsed on every render it was a new array every time, and a provider keyed
 * on the array rebuilt its store and identified again on each one. A value
 * that is not a non-empty JSON array of strings is reported once and ignored,
 * rather than thrown from a render that would take the page down with it.
 */
let parsedFrom: string | undefined
let parsed: string[] | undefined

function parsedEndpoints(raw: string): string[] | undefined {
  if (raw === parsedFrom) return parsed
  parsedFrom = raw
  parsed = undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) parsed = value
  } catch {
    // Reported below, with the other malformed shapes.
  }
  if (parsed === undefined) {
    console.error('[fingerly] NEXT_PUBLIC_FINGERLY_ENDPOINTS must be a non-empty JSON array of strings; it is ignored.')
  }
  return parsed
}

/** Reported once per process rather than on every render. */
let reportedMissingKey = false

export function FingerlyProvider(props: FingerlyNextProviderProps): ReactNode {
  const environment = fromEnvironment()
  const apiKey = props.apiKey ?? environment.apiKey
  const endpoints = props.endpoints ?? environment.endpoints

  if (!apiKey && !reportedMissingKey) {
    // Reported, not thrown: a missing fraud-signal key must not take the
    // page down. Identification fails with the SDK's own error instead.
    reportedMissingKey = true
    console.error(
      '[fingerly] No Fingerly key. Pass one from a Server Component, which is the arrangement that ' +
        'always works:\n\n' +
        '  // app/layout.tsx\n' +
        '  <FingerlyProvider apiKey={process.env.FINGERLY_API_KEY}>\n\n' +
        'Reading it here instead works only where this package is compiled by your app - ' +
        "an app that lists it in `transpilePackages` and sets NEXT_PUBLIC_FINGERLY_API_KEY. A published " +
        'build cannot rely on that: Next inlines NEXT_PUBLIC_ variables while compiling, and ' +
        'a dependency it does not compile keeps a `process.env` lookup that is undefined in a browser.',
    )
  }

  return (
    <ReactFingerlyProvider
      apiKey={apiKey ?? ''}
      {...(props.apiVersion === undefined ? {} : { apiVersion: props.apiVersion })}
      {...(endpoints === undefined ? {} : { endpoints })}
      {...(props.fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint: props.fallbackToDefaultEndpoint })}
      {...(props.submit === undefined ? {} : { submit: props.submit })}
      {...(props.consent === undefined ? {} : { consent: props.consent })}
    >
      {props.children}
    </ReactFingerlyProvider>
  )
}
