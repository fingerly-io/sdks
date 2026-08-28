'use client'

/**
 * @badele/next - the Badele SDK in a Next.js app.
 *
 * Thin on purpose. `@badele/react` already holds the client, the shared
 * identification and the hooks; what Next adds is where the configuration
 * comes from, where the client boundary sits, and how an identification
 * reaches a Server Action. Those three things are this package.
 *
 * The directive above is load-bearing: every export here reaches a hook, so
 * the whole entry is a client module. That is what lets `app/layout.tsx` stay
 * a Server Component while rendering `<BadeleProvider>` inside it. The server
 * half lives at `@badele/next/server`, which has no React in it at all.
 */

export { BadeleProvider } from './provider.js'
export type { BadeleNextProviderProps } from './provider.js'

export { BadeleRequestId } from './field.js'
export type { BadeleRequestIdProps } from './field.js'

export { REQUEST_ID_FIELD } from './field-name.js'

// The hooks, re-exported so an app installs one package rather than two. They
// are @badele/react's, unchanged - there is nothing Next-specific about
// reading a verdict, and wrapping them to say so would only add a layer to
// step through when something is wrong.
export { useBadele, useIdentify, useVerdict, createBadeleStore, BadeleServerError } from '@badele/react'
export type {
  BadeleReactOptions,
  BadeleState,
  BadeleStore,
  Confidence,
  IdentifyResult,
  SignalReport,
  UseIdentifyOptions,
  UseIdentifyReturn,
  UseVerdictReturn,
  Verdict,
  VerdictName,
  Verdicts,
} from '@badele/react'
export { TransportError } from '@badele/react'
