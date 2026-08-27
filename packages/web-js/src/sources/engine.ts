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

import { SOURCE, type EngineSignal, type Source } from '@badele/core'

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
