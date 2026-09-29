/**
 * What the JavaScript engine is, established by behaviour rather than by asking.
 *
 * The user-agent is a string the browser volunteers and anyone can rewrite. The
 * engine underneath it is much harder to lie about, because it shows through in
 * places nobody thinks of as identifying: the length of an error message, the
 * source text of a builtin, the shape of a stack trace. None of those have an
 * override switch, and a spoofer who patches the builtins to fix them leaves
 * patched builtins behind - which `lies/` then finds.
 *
 * The `toFixed` probe is `detectincognitojs`'s idea, generalised. This file
 * runs several independent probes instead of one, because one probe is a single
 * patch away from useless.
 */

import {
  hash64,
  SOURCE,
  type EngineSignal,
  type ErrorsSignal,
  type MathSignal,
  type Source,
} from '@fingerly/core'

import { attempt, compact } from '../util.js'

/**
 * `(-1).toFixed(-1)` throws a RangeError whose message differs per engine.
 *
 * V8 says "toFixed() digits argument must be between 0 and 100" (51),
 * JavaScriptCore and SpiderMonkey word it differently and at different lengths.
 * The *length* is used rather than the text so that a localised or slightly
 * reworded message across versions still lands in the right bucket - and so
 * that this file does not carry three English sentences that a browser release
 * can invalidate.
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
 * The shape of a stack trace.
 *
 * V8 puts an `Error: message` header on the first line and indents frames with
 * `    at `. SpiderMonkey and JavaScriptCore both use `function@url:line:col`
 * with no header, and are told apart by SpiderMonkey's `@` appearing even for
 * the top-level frame with an empty function name.
 */
function stackStyle(): EngineSignal['stack_style'] {
  return attempt<EngineSignal['stack_style']>(() => {
    const stack = new Error('probe').stack
    if (typeof stack !== 'string' || stack === '') return undefined
    if (stack.includes('    at ')) return 'v8'
    if (/^@|\n@|^\w*@/m.test(stack)) {
      // Both remaining engines use this shape. JavaScriptCore names the
      // top-level frame `global code`; SpiderMonkey leaves it empty.
      return stack.includes('global code') ? 'javascriptcore' : 'spidermonkey'
    }
    return 'unknown'
  })
}

/**
 * Reconcile the probes into one engine name.
 *
 * A majority rather than a chain, so that patching any single probe does not
 * change the answer - and so that a *disagreement between the probes* is
 * visible, which is itself the signature of a partial spoof.
 */
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

/** What the user-agent claims, reduced to the same three names. */
function claimedEngine(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined
  // Order matters: every Chromium UA also contains "Safari", and Edge and Opera
  // contain "Chrome". Testing for the most specific marker first.
  if (/Firefox\/|FxiOS/.test(userAgent)) return 'gecko'
  if (/Edg\/|OPR\/|Chrome\/|Chromium\//.test(userAgent)) return 'chromium'
  if (/Safari\//.test(userAgent)) return 'webkit'
  return undefined
}

export const engineSource: Source<EngineSignal> = {
  id: SOURCE.engine,
  tier: 'fast',
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
      // Undefined rather than false when either side is unknown. "We could not
      // tell" and "they disagree" are different findings, and the automation
      // detector weighs the second one heavily.
      agrees: observed === undefined || claimed === undefined ? undefined : observed === claimed,
    })
  },
}

// ---------------------------------------------------------------------------
// Transcendental maths.
// ---------------------------------------------------------------------------

/**
 * The probes, in a fixed order, because the order is part of the hash.
 *
 * Chosen for spread rather than for elegance: inverse trigonometric functions
 * at awkward arguments, hyperbolics, and the exponentials, which is where
 * engines' libm implementations diverge. Appending is safe; reordering or
 * removing is not, and would silently change every stored hash.
 */
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

/**
 * Identities every conforming engine gets right, on every platform.
 *
 * These are exact by specification rather than by implementation, so a visitor
 * whose maths misses them is not on an unusual CPU: `Math` has been replaced.
 * That is what the extensions which add noise to fingerprintable APIs do, and
 * it is worth reporting separately from the hash - a hash nobody has seen
 * before looks the same whether it came from a rare machine or from a patched
 * one.
 */
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
  tier: 'fast',
  timeoutMs: 50,
  run() {
    const results: string[] = []
    let probed = 0
    const values = new Map<string, number>()

    for (const [name, probe] of MATH_PROBES) {
      const value = attempt(probe)
      // A probe that threw or returned a non-number still occupies its slot in
      // the vector, so a browser missing one function does not shift every
      // hash after it.
      if (typeof value === 'number' && Number.isFinite(value)) {
        probed += 1
        values.set(name, value)
        results.push(`${name}:${value}`)
      } else {
        results.push(`${name}:`)
      }
    }

    return compact<MathSignal>({
      hash: hash64(results.join('|')),
      probed,
      // The two the engines were measured to disagree about. See MathSignal
      // for the numbers; the other seventeen agreed to the last bit on the
      // machine they were measured on, which is why they are only in the hash.
      atanh_half: values.get('atanh'),
      expm1_1: values.get('expm1'),
      identities_hold: attempt(identitiesHold),
    })
  },
}

// ---------------------------------------------------------------------------
// Error shapes.
// ---------------------------------------------------------------------------

/**
 * The length of the message a throwing expression produces, if it throws.
 *
 * An EvalError is not the error being measured: it is a Content-Security-Policy
 * without 'unsafe-eval' refusing `new Function` before the code ever ran, and
 * its message is the browser's CSP wording. Measuring it would report that
 * length as the engine's, and vote for the wrong engine.
 */
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

/**
 * Whether this page lets code be compiled from a string.
 *
 * Learned from the first probe that tries, not asked up front: there is no way
 * to ask a CSP without being refused by it. Every refusal also sends the page's
 * CSP report, so once one probe has been refused the rest are not attempted.
 */
function evalAllowed(): boolean {
  try {
    new Function('')
    return true
  } catch {
    return false
  }
}

/** Whether a caught error carries a given non-standard property. */
function errorCarries(property: string): boolean | undefined {
  return attempt(() => {
    try {
      throw new Error('probe')
    } catch (error) {
      return property in (error as object)
    }
  })
}

/**
 * Which engine the error shapes point at.
 *
 * Rebuilt around what was measured rather than what every fingerprinting
 * library still assumes. `Error.captureStackTrace` and `Error.stackTraceLimit`
 * were V8's alone for years; Firefox 154 has both, and voting on them made
 * this collector report an ordinary Firefox as chromium - which then produced
 * two contradictions against an honest browser, the exact false positive this
 * codebase exists to avoid.
 *
 * What does still separate them, measured on Chrome 151 and Firefox 154:
 *
 *   own properties of a caught Error   message,stack   (V8)
 *                                      columnNumber,fileName,lineNumber,message
 *                                      (SpiderMonkey, which puts stack on the
 *                                      prototype)
 *   null.x message length              44 / 33
 *   new Function('!') message length   20 / 28
 *
 * The property shape votes twice because it is structural - an engine would
 * have to move `stack` off its prototype to fake it - and the lengths vote
 * once each, because a browser release can reword a message.
 *
 * JavaScriptCore has since been measured, on Safari 26.5 / macOS: its caught
 * Error carries `column,line,message,sourceURL,stack`. That is the reading that
 * corrected the assumption this comment used to record - that Safari would
 * report `undefined` here and nothing would fire on it. It did not report
 * `undefined`; it reported `chromium`, because it has an own `stack` too.
 *
 * The message *lengths* are still not measured for JavaScriptCore, and are
 * deliberately not guessed. They are the weaker probe on this engine anyway:
 * JSC embeds the source text of the failing expression in the message, so the
 * length moves with whatever the bundler named the variable.
 */
export function observedFromErrors(errors: Omit<ErrorsSignal, 'observed'>): string | undefined {
  const votes: string[] = []
  const own = errors.own_properties

  if (own !== undefined) {
    // Exact match for V8, substring for the other two, and the asymmetry is the
    // bug this once had. `stack` is not a V8 marker - JavaScriptCore has an own
    // `stack` as well, and only SpiderMonkey keeps it on the prototype - so
    // `includes('stack')` voted chromium twice for every Safari on earth. That
    // contradicted the engine probe's honest `webkit`, and `detect/automation`
    // read the disagreement as a spoof: Safari 26 reported itself automated,
    // with `low` confidence and two reasons that were the same fact counted
    // twice.
    //
    // What actually separates them is which *extra* properties are there.
    // `sourceURL` is JavaScriptCore's alone and `lineNumber` is SpiderMonkey's
    // alone, so both are checked before falling through to the pair V8 leaves
    // behind - and V8's is matched exactly, because "exactly message and stack"
    // is the claim, not "stack appears somewhere".
    if (own.includes('sourceURL')) votes.push('webkit', 'webkit')
    else if (own.includes('lineNumber')) votes.push('gecko', 'gecko')
    else if (own === 'message,stack') votes.push('chromium', 'chromium')
  }

  if (errors.null_property_length === 44) votes.push('chromium')
  else if (errors.null_property_length === 33) votes.push('gecko')

  if (errors.syntax_length === 20) votes.push('chromium')
  else if (errors.syntax_length === 28) votes.push('gecko')

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

  // A tie is a browser wearing two engines' markers at once, which is not an
  // engine and must not be reported as one.
  return tied ? undefined : winner
}

/** The own property names of a caught Error, sorted so the string is stable. */
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
  tier: 'fast',
  timeoutMs: 50,
  run() {
    // One attempt at compiling from a string, not one per probe: under a strict
    // Content-Security-Policy each refusal is a violation report to the
    // customer's endpoint, and both string probes are then skipped.
    const compiles = evalAllowed()
    const shapes = compact<Omit<ErrorsSignal, 'observed'>>({
      null_property_length: thrownMessageLength(() => (null as unknown as { x: unknown }).x),
      // `new Function` rather than `eval`, because a page with a strict
      // Content-Security-Policy blocks both and this way the failure is one
      // probe reporting nothing rather than the source throwing.
      syntax_length: compiles ? thrownMessageLength(() => new Function('!')) : undefined,
      json_parse_length: thrownMessageLength(() => JSON.parse('{')),
      invalid_array_length: thrownMessageLength(() => {
        const array: number[] = []
        array.length = -1
      }),
      const_assign_length: compiles
        ? thrownMessageLength(() => {
            // The only way to reach this error without a syntax error at parse
            // time. Skipped under a strict CSP, like the probe above.
            new Function('const c = 1; c = 2')()
          })
        : undefined,
      own_properties: errorOwnProperties(),
      capture_stack_trace: attempt(
        () => typeof (Error as unknown as { captureStackTrace?: unknown }).captureStackTrace === 'function',
      ),
      stack_trace_limit: attempt(() => 'stackTraceLimit' in Error),
    })

    return compact<ErrorsSignal>({ ...shapes, observed: observedFromErrors(shapes) })
  },
}
