'use client'

/**
 * @badele/react - React bindings for the Badele SDK.
 *
 * A provider that holds one client and one shared identification, and hooks
 * that read it. See the README for the whole surface with examples.
 *
 * The directive above is load-bearing. Every export here reaches a hook, so
 * the whole entry is a client module; a Next.js App Router build that imports
 * it from a server component without it fails at the first hook with "you're
 * importing a component that needs useSyncExternalStore". It survives the
 * build because this package does not tree shake - see tsup.config.ts.
 */

export { BadeleContext, BadeleProvider } from './context.js'
export type { BadeleProviderProps } from './context.js'

export { BadeleServerError, createBadeleStore } from './store.js'
export type { BadeleReactOptions, BadeleState, BadeleStore } from './store.js'

export { useBadele } from './useBadele.js'
export { useIdentify } from './useIdentify.js'
export type { UseIdentifyOptions, UseIdentifyReturn } from './useIdentify.js'
export { useVerdict } from './useVerdict.js'
export type { UseVerdictReturn, VerdictName } from './useVerdict.js'

// Re-exported so a component can name what it receives without also declaring
// a dependency on the browser SDK.
export type {
  BadeleWebEvent,
  Confidence,
  IdentifyResult,
  IntegrityReport,
  Lie,
  SignalOutcome,
  SignalReport,
  SignalStatus,
  Verdict,
  Verdicts,
} from '@badele/web-js'
export { TransportError } from '@badele/web-js'
