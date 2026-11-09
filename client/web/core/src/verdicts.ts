/**
 * What is left of the client-side verdicts.
 *
 * Nothing here decides anything. Everything about how evidence adds up lives on
 * the server, because customers set the weights and a page is code the visitor
 * controls. This file only carries the server's answer into the shape 0.1.x
 * returned, for one transition version, and keeps the old exports importable so
 * upgrading does not break a build.
 *
 * Each export is deprecated and warns once in development. Read `suspectLevel`
 * and `triggers` instead.
 */

import type { Confidence, IdentifyResult, IdentifyTrigger, SignalReport, Verdict, Verdicts } from './types.js'

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

/**
 * Which server signal each deprecated verdict follows.
 *
 * Written out rather than derived, so the mapping is plain and the set of
 * verdicts is the one the old type promised. `emulator` reports under
 * `virtual_machine`. `shields` follows nothing, because a browser's privacy
 * protection is not a finding and the server fires no signal for it, so it
 * always holds no answer rather than a clean false.
 */
const VERDICT_SIGNAL: Readonly<Record<keyof Verdicts, string | null>> = {
  incognito: 'incognito',
  shields: null,
  tor: 'tor',
  emulator: 'virtual_machine',
  automation: 'automation',
  farm: 'device_farm',
}

const VERDICT_NAMES = Object.keys(VERDICT_SIGNAL) as (keyof Verdicts)[]

/** A verdict with no answer behind it. Not clean: unknown. */
function unanswered(): Verdict {
  return { value: null, confidence: 'low', reasons: [] }
}

function confidenceOf(trigger: IdentifyTrigger): Confidence {
  const confidence = trigger.confidence as Confidence
  return confidence === 'low' || confidence === 'medium' || confidence === 'high' ? confidence : 'low'
}

/** The empty set, for every case where no server answered. */
export function unansweredVerdicts(): Verdicts {
  return Object.fromEntries(VERDICT_NAMES.map((name) => [name, unanswered()])) as unknown as Verdicts
}

/**
 * The server's triggers, in the shape 0.1.x returned.
 *
 * Unscored (`suspectLevel` is null) means nothing fired *and* nobody looked,
 * which is why that case reports nothing rather than all clear.
 */
export function verdictsFromTriggers(
  triggers: readonly IdentifyTrigger[],
  suspectLevel: string | null,
): Verdicts {
  if (suspectLevel === null) return unansweredVerdicts()

  const bySignal = new Map(triggers.map((trigger) => [trigger.signal, trigger]))
  const result = {} as Record<keyof Verdicts, Verdict>
  for (const name of VERDICT_NAMES) {
    const signal = VERDICT_SIGNAL[name]
    if (signal === null) {
      result[name] = unanswered()
      continue
    }
    const trigger = bySignal.get(signal)
    result[name] = trigger
      ? { value: true, confidence: confidenceOf(trigger), reasons: trigger.reason ? trigger.reason.split('+') : [] }
      : { value: false, confidence: 'low', reasons: [] }
  }
  return result
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
        'read suspectLevel and triggers instead. These verdicts are only a copy of the server triggers now.',
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
  const attached = (result as WithVerdicts)[VERDICTS]
  if (attached) return attached
  // A result that did not come from [[FingerlyClient]], such as a test double
  // or a custom transport's hand-rolled answer, carries the field plainly.
  return (result as { verdicts?: Verdicts }).verdicts ?? unansweredVerdicts()
}

/** Whether `suspectLevel` says the check is worth a look; null when unscored. */
export function isSuspiciousLevel(level: string | null): boolean | null {
  if (level === null) return null
  return level === 'medium' || level === 'high'
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
  warnDeprecated(name, 'detection moved to the server. Read triggers on the identify() result.')
  return unanswered()
}

/** @deprecated Detection moved to the server. Always empty. */
export function detectAll(_report: SignalReport): Verdicts {
  warnDeprecated('detectAll', 'detection moved to the server. Read triggers on the identify() result.')
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
  warnDeprecated('farblesFingerprints', 'detection moved to the server.')
  return false
}

/** @deprecated Detection moved to the server. Always undefined. */
export function trustedDeviceMemory(_report: SignalReport): number | undefined {
  warnDeprecated('trustedDeviceMemory', 'detection moved to the server.')
  return undefined
}
