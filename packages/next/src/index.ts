'use client'

/**
 * @fingerly/next - the Fingerly SDK in a Next.js app.
 *
 * Thin on purpose. `@fingerly/react` already holds the client, the shared
 * identification and the hooks; what Next adds is where the configuration
 * comes from, where the client boundary sits, and how an identification
 * reaches a Server Action. Those three things are this package.
 *
 * The directive above is load-bearing: every export here reaches a hook, so
 * the whole entry is a client module. That is what lets `app/layout.tsx` stay
 * a Server Component while rendering `<FingerlyProvider>` inside it. The server
 * half lives at `@fingerly/next/server`, which has no React in it at all.
 */

export { FingerlyProvider } from './provider.js'
export type { FingerlyNextProviderProps } from './provider.js'

export { FingerlyRequestId } from './field.js'
export type { FingerlyRequestIdProps } from './field.js'

export { REQUEST_ID_FIELD } from './field-name.js'

// The hooks, re-exported so an app installs one package rather than two. They
// are @fingerly/react's, unchanged - there is nothing Next-specific about
// reading a verdict, and wrapping them to say so would only add a layer to
// step through when something is wrong.
export { useFingerly, useIdentify, useVerdict, createFingerlyStore, FingerlyServerError } from '@fingerly/react'
export type {
  FingerlyReactOptions,
  FingerlyState,
  FingerlyStore,
  Confidence,
  ConsentState,
  IdentifyResult,
  IdentifyTrigger,
  SignalReport,
  UseIdentifyOptions,
  UseIdentifyReturn,
  UseVerdictReturn,
  Verdict,
  VerdictName,
  Verdicts,
} from '@fingerly/react'
export { ConsentError, TransportError } from '@fingerly/react'
