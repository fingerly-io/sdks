/**
 * What the JavaScript and CSS engine is, established by behaviour and structure
 * rather than by asking.
 */

import {
  SOURCE,
  type EngineSignal,
  type ErrorsSignal,
  type MathSignal,
  type Source,
  type SourceContext,
} from '@fingerly/core'

import { attempt, compact } from '../util.js'

/**
 * `(-1).toFixed(-1)` throws a RangeError whose message length differs per engine:
 * 51 on V8, 43/44 on JavaScriptCore, 25 on SpiderMonkey.
 */
function toFixedErrorLength(): number | undefined {
  return attempt(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      ;(-1).toFixed(-1)
    } catch (error) {
      return error instanceof Error ? error.message.length : undefined
    }
    return undefined
  })
}

/** `eval.toString().length`: 33 on V8, 37 on JSC and SpiderMonkey, 39 on IE. */
function evalLength(): number | undefined {
  return attempt(() => eval.toString().length)
}

/**
 * The shape of a stack trace (`v8`, `spidermonkey`, `javascriptcore`, or `unknown`).
 */
function stackStyle(): EngineSignal['stack_style'] {
  return attempt<EngineSignal['stack_style']>(() => {
    const stack = new Error('probe').stack
    if (typeof stack !== 'string' || stack === '') return undefined
    if (stack.includes('    at ')) return 'v8'
    if (/^@|\n@|^\w*@/m.test(stack)) {
      return stack.includes('global code') ? 'javascriptcore' : 'spidermonkey'
    }
    return 'unknown'
  })
}

function observedEngine(
  toFixed: number | undefined,
  evalLen: number | undefined,
  stack: EngineSignal['stack_style'],
): string | undefined {
  const votes: string[] = []

  if (toFixed === 51) votes.push('chromium')
  else if (toFixed === 43 || toFixed === 44) votes.push('webkit')
  else if (toFixed === 25) votes.push('gecko')

  if (evalLen === 33) votes.push('chromium')

  if (stack === 'v8') votes.push('chromium')
  else if (stack === 'javascriptcore') votes.push('webkit')
  else if (stack === 'spidermonkey') votes.push('gecko')

  if (votes.length === 0) return undefined

  const tally = new Map<string, number>()
  for (const vote of votes) tally.set(vote, (tally.get(vote) ?? 0) + 1)

  let winner: string | undefined
  let best = 0
  for (const [engine, count] of tally) {
    if (count > best) {
      best = count
      winner = engine
    }
  }
  return winner
}

/** What the user-agent claims, reduced to `'gecko' | 'chromium' | 'webkit'`. */
export function claimedEngine(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined
  if (/Firefox\//.test(userAgent)) return 'gecko'
  if (/Edg\/|OPR\/|Chrome\/|Chromium\//.test(userAgent)) return 'chromium'
  if (/Safari\//.test(userAgent)) return 'webkit'
  return undefined
}

function cssSupports(property: string, value: string): boolean | undefined {
  return attempt(() =>
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
      ? CSS.supports(property, value)
      : undefined,
  )
}

/**
 * Structural check for iOS WebKit's `DeviceMotionEvent.requestPermission` static
 * method. NEVER invokes the method (Rule #1).
 */
function hasMotionPermissionFn(): boolean {
  return (
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof (DeviceMotionEvent as unknown as { requestPermission?: unknown }).requestPermission ===
      'function'
  )
}

/**
 * Determines whether the runtime is (or claims/exhibits markers of) Gecko so
 * the `<= 3ms` RFP timer probe runs on Gecko while WebKit and Blink incur `0.0ms`
 * timer-wait overhead.
 */
export function isGeckoEngine(ctx?: SourceContext): boolean {
  const completed = ctx?.completed?.(SOURCE.engine)
  if (completed?.status === 'ok') {
    const val = completed.value as EngineSignal | undefined
    if (val?.observed === 'gecko' || val?.claimed === 'gecko') return true
    if (val?.moz_appearance === true && cssSupports('-fingerly-nonexistent', 'none') !== true) {
      return true
    }
  }

  if (observedEngine(toFixedErrorLength(), evalLength(), stackStyle()) === 'gecko') {
    return true
  }

  const ua = attempt(() => (typeof navigator === 'undefined' ? undefined : navigator.userAgent))
  if (claimedEngine(ua) === 'gecko') return true
  if (ua && /\bGecko\/\d/i.test(ua) && !/like Gecko|FxiOS/i.test(ua)) return true

  // CSS / style structural Gecko markers (rejecting synthetic DOM stubs that
  // answer true for arbitrary unknown properties).
  if (
    cssSupports('-moz-appearance', 'none') === true &&
    cssSupports('-fingerly-nonexistent', 'none') !== true
  ) {
    return true
  }

  const rootStyle = attempt(() =>
    typeof document === 'undefined' ? undefined : document.documentElement?.style,
  )
  if (rootStyle && 'MozAppearance' in rootStyle && !('FingerlyNonexistent' in rootStyle)) {
    return true
  }

  return false
}

export const engineSource: Source<EngineSignal> = {
  id: SOURCE.engine,
  stage: 'prerequisite',
  embeddedSafe: true,
  run() {
    const toFixed = toFixedErrorLength()
    const evalLen = evalLength()
    const stack = stackStyle()

    const observed = observedEngine(toFixed, evalLen, stack)
    const claimed = claimedEngine(
      typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    )

    return compact<EngineSignal>({
      to_fixed_error_length: toFixed,
      eval_length: evalLen,
      stack_style: stack,
      observed,
      claimed,
      has_motion_permission_fn: attempt(hasMotionPermissionFn),
      moz_appearance: cssSupports('-moz-appearance', 'none'),
      webkit_touch_callout: cssSupports('-webkit-touch-callout', 'none'),
    })
  },
}

// ---------------------------------------------------------------------------
// Transcendental maths.
// ---------------------------------------------------------------------------

const MATH_PROBES: readonly (readonly [string, () => number])[] = [
  ['acos', () => Math.acos(0.123124234234234242)],
  ['acosh', () => Math.acosh(1e308)],
  ['asin', () => Math.asin(0.123124234234234242)],
  ['asinh', () => Math.asinh(1)],
  ['atan', () => Math.atan(0.5)],
  ['atanh', () => Math.atanh(0.5)],
  ['cbrt', () => Math.cbrt(100)],
  ['cos', () => Math.cos(10.000000000123)],
  ['cosh', () => Math.cosh(1)],
  ['exp', () => Math.exp(1)],
  ['expm1', () => Math.expm1(1)],
  ['log', () => Math.log(10)],
  ['log1p', () => Math.log1p(10)],
  ['pow', () => Math.pow(Math.PI, -100)],
  ['sin', () => Math.sin(1e300)],
  ['sinh', () => Math.sinh(1)],
  ['sqrt', () => Math.sqrt(2)],
  ['tan', () => Math.tan(-1e300)],
  ['tanh', () => Math.tanh(1)],
]

function identitiesHold(): boolean {
  return (
    Object.is(Math.sin(0), 0) &&
    Math.cos(0) === 1 &&
    Math.sqrt(4) === 2 &&
    Math.log(1) === 0 &&
    Math.pow(2, 10) === 1024
  )
}

export const mathSource: Source<MathSignal> = {
  id: SOURCE.math,
  stage: 'collect',
  embeddedSafe: true,
  identityCritical: true,
  timeoutMs: 50,
  run() {
    let probed = 0
    const values = new Map<string, number>()

    for (const [name, probe] of MATH_PROBES) {
      const value = attempt(probe)
      if (typeof value === 'number' && Number.isFinite(value)) {
        probed += 1
        values.set(name, value)
      }
    }

    // No digest of the results: no server rule reads one (`WEB-14`).
    return compact<MathSignal>({
      probed,
      atanh_half: values.get('atanh'),
      expm1_1: values.get('expm1'),
      identities_hold: attempt(identitiesHold),
    })
  },
}

// ---------------------------------------------------------------------------
// Error shapes.
// ---------------------------------------------------------------------------

function thrownMessageLength(throwing: () => unknown): number | undefined {
  return attempt(() => {
    try {
      throwing()
    } catch (error) {
      if (error instanceof EvalError) return undefined
      return error instanceof Error ? error.message.length : undefined
    }
    return undefined
  })
}

/** A RegExp syntax error: compiled, not evaluated, so CSP does not apply. */
function regexpSyntaxError(): unknown {
  return new RegExp('(')
}

/** A TypeError that strict and sloppy code raise alike. */
function redefineFrozen(): unknown {
  return Object.defineProperty(Object.freeze({ x: 1 }), 'x', { value: 2 })
}

export function observedFromErrors(errors: Omit<ErrorsSignal, 'observed'>): string | undefined {
  const votes: string[] = []
  const own = errors.own_properties

  if (own !== undefined) {
    if (own.includes('sourceURL')) votes.push('webkit', 'webkit')
    else if (own.includes('lineNumber')) votes.push('gecko', 'gecko')
    else if (own === 'message,stack') votes.push('chromium', 'chromium')
  }

  if (errors.null_property_length === 44) votes.push('chromium')
  else if (errors.null_property_length === 33) votes.push('gecko')

  // Measured: V8 51 and 27, JavaScriptCore 37 and 50.
  if (errors.regexp_syntax_length === 51) votes.push('chromium')
  else if (errors.regexp_syntax_length === 37) votes.push('webkit')

  if (errors.redefine_length === 27) votes.push('chromium')
  else if (errors.redefine_length === 50) votes.push('webkit')

  if (votes.length === 0) return undefined

  const tally = new Map<string, number>()
  for (const vote of votes) tally.set(vote, (tally.get(vote) ?? 0) + 1)

  let winner: string | undefined
  let best = 0
  let tied = false
  for (const [engine, count] of tally) {
    if (count > best) {
      best = count
      winner = engine
      tied = false
    } else if (count === best) {
      tied = true
    }
  }

  return tied ? undefined : winner
}

function errorOwnProperties(): string | undefined {
  return attempt(() => {
    try {
      throw new Error('probe')
    } catch (error) {
      return Object.getOwnPropertyNames(error as object).sort().join(',')
    }
  })
}

export const errorsSource: Source<ErrorsSignal> = {
  id: SOURCE.errors,
  stage: 'collect',
  embeddedSafe: true,
  identityCritical: true,
  timeoutMs: 50,
  // No `new Function` or `eval` call (`WEB-10`): under a policy without
  // 'unsafe-eval' each one raised a CSP violation report on every run, and
  // three per run in report-only mode. Every probe here throws without
  // evaluating code.
  run() {
    const shapes = compact<Omit<ErrorsSignal, 'observed'>>({
      null_property_length: thrownMessageLength(() => (null as unknown as { x: unknown }).x),
      json_parse_length: thrownMessageLength(() => JSON.parse('{')),
      invalid_array_length: thrownMessageLength(() => {
        const array: number[] = []
        array.length = -1
      }),
      regexp_syntax_length: thrownMessageLength(regexpSyntaxError),
      redefine_length: thrownMessageLength(redefineFrozen),
      own_properties: errorOwnProperties(),
      capture_stack_trace: attempt(
        () =>
          typeof (Error as unknown as { captureStackTrace?: unknown }).captureStackTrace ===
          'function',
      ),
      stack_trace_limit: attempt(() => 'stackTraceLimit' in Error),
    })

    return compact<ErrorsSignal>({ ...shapes, observed: observedFromErrors(shapes) })
  },
}
