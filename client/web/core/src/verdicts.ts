/**
 * What is left of the client-side verdicts.
 *
 * Nothing here decides anything. Everything about how evidence adds up lives on
 * the server, because customers set the weights and a page is code the visitor
 * controls. A public caller is no longer told which signals fired, so the
 * verdicts have nothing to work from: they hold nothing, and exist so upgrading
 * from 0.1.x does not break a build.
 *
 * Each export is deprecated and warns once in development. Read `suspectLevel`
 * in the page, and read signals on your backend.
 */

import type { IdentifyResult, SignalReport, Verdict, Verdicts } from './types.js'

// Declared here rather than taken from @types/node, because this package also
// builds for a bare <script> tag. It is only read inside a try: without a
// bundler to inline it, the reference throws, and that means a production page.
declare const process: { env: { NODE_ENV?: string } }

function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV !== 'production'
  } catch {
    return false
  }
}

const warned = new Set<string>()

/**
 * Warn once per key, in development only.
 *
 * Exported for the framework bindings, so `useVerdict`, `injectVerdict` and the
 * rest share one once-only set with the kernel rather than each keeping their
 * own, and so a page importing two bindings is told once rather than twice.
 *
 * @internal
 */
export function warnDeprecated(key: string, message: string): void {
  if (warned.has(key) || !isDevelopment()) return
  warned.add(key)
  console.warn(`[fingerly] ${key} is deprecated: ${message}`)
}

/** For tests, so one case's warning does not silence the next. @internal */
export function resetDeprecationWarnings(): void {
  warned.clear()
}

const VERDICT_NAMES: readonly (keyof Verdicts)[] = ['incognito', 'shields', 'tor', 'emulator', 'automation', 'farm']

/** A verdict with no answer behind it. Not clean: unknown. */
function unanswered(): Verdict {
  return { value: null, confidence: 'low', reasons: [] }
}

/**
 * Every verdict, holding nothing.
 *
 * Always this, even for a response that still carries `triggers`: an absent
 * trigger cannot say "the server looked and found nothing", so deriving a
 * `false` from one would be a false clean.
 */
export function unansweredVerdicts(): Verdicts {
  return Object.fromEntries(VERDICT_NAMES.map((name) => [name, unanswered()])) as unknown as Verdicts
}

const VERDICTS = Symbol('fingerly.verdicts')

type WithVerdicts = IdentifyResult & { [VERDICTS]?: Verdicts }

/**
 * Attach the derived verdicts behind a warning getter.
 *
 * A getter rather than a plain field, so reading `result.verdicts` warns even
 * though the object was built before anyone asked. The value itself lives on a
 * symbol the bindings read through [[verdictsOf]].
 *
 * @internal
 */
export function attachVerdicts(result: IdentifyResult, verdicts: Verdicts): void {
  Object.defineProperty(result, VERDICTS, { value: verdicts, enumerable: false })
  Object.defineProperty(result, 'verdicts', {
    enumerable: true,
    configurable: true,
    get(this: WithVerdicts): Verdicts {
      warnDeprecated(
        'IdentifyResult.verdicts',
        'read suspectLevel here, and read signals on your backend. A browser is no longer told which signals fired, so this holds nothing.',
      )
      return verdicts
    },
  })
}

/**
 * The verdicts on a result, without the deprecation warning.
 *
 * For a binding copying a result into its own state, which must not warn on
 * behalf of a page that never read the field.
 *
 * @internal
 */
export function verdictsOf(result: IdentifyResult): Verdicts {
  // A plain `verdicts` field on a hand-built result is not read: nothing a
  // server answers can back it, so it could only be a false clean.
  return (result as WithVerdicts)[VERDICTS] ?? unansweredVerdicts()
}

/**
 * Whether `suspectLevel` says the check is worth a look.
 *
 * Null whenever the level is absent, which covers unscored and hidden alike,
 * and for a level this version does not know: only an explicit `low` is clean.
 */
export function isSuspiciousLevel(level: string | null | undefined): boolean | null {
  if (level === 'medium' || level === 'high') return true
  return level === 'low' ? false : null
}

// ---------------------------------------------------------------------------
// The exports that used to compute these. They keep their names so an import
// does not fail, and compute nothing.
// ---------------------------------------------------------------------------

/** @deprecated Scoring moved to the server; this constant is no longer used. */
export const BRAVE_SYNTHETIC_QUOTA = 2_147_483_648

/** @deprecated Scoring moved to the server. */
export interface Evidence {
  reason: string
  weight: number
}

function stub(name: string): Verdict {
  warnDeprecated(name, 'detection moved to the server. Read signals on your backend.')
  return unanswered()
}

/** @deprecated Detection moved to the server. Always empty. */
export function detectAll(_report: SignalReport): Verdicts {
  warnDeprecated('detectAll', 'detection moved to the server. Read signals on your backend.')
  return unansweredVerdicts()
}

/** @deprecated Detection moved to the server. Always empty. */
export function detectAutomation(_report: SignalReport): Verdict {
  return stub('detectAutomation')
}

/** @deprecated Detection moved to the server. Always empty. */
export function detectEmulator(_report: SignalReport): Verdict {
  return stub('detectEmulator')
}

/** @deprecated Detection moved to the server. Always empty. */
export function detectFarm(_report: SignalReport): Verdict {
  return stub('detectFarm')
}

/** @deprecated Detection moved to the server. Always empty. */
export function detectIncognito(_report: SignalReport): Verdict {
  return stub('detectIncognito')
}

/** @deprecated Detection moved to the server. Always empty. */
export function detectShields(_report: SignalReport): Verdict {
  return stub('detectShields')
}

/** @deprecated Detection moved to the server. Always empty. */
export function detectTor(_report: SignalReport): Verdict {
  return stub('detectTor')
}

/** @deprecated Scoring moved to the server. Always empty. */
export function weigh(_evidence: Evidence[], _scale = 1): Verdict {
  return stub('weigh')
}

/** @deprecated Scoring moved to the server. Always empty. */
export function unknown(): Verdict {
  return stub('unknown')
}

/** @deprecated Detection moved to the server. Always false. */
export function farblesFingerprints(_report: SignalReport): boolean {
  warnDeprecated('farblesFingerprints', 'detection moved to the server. Read signals on your backend.')
  return false
}

/** @deprecated Detection moved to the server. Always undefined. */
export function trustedDeviceMemory(_report: SignalReport): number | undefined {
  warnDeprecated('trustedDeviceMemory', 'detection moved to the server. Read signals on your backend.')
  return undefined
}
