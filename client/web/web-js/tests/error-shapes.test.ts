/**
 * Which engine a caught Error's own properties point at.
 *
 * Split out of the collector because the three answers cannot all be produced
 * on one machine: whichever engine runs the test supplies its own shapes and
 * nothing else. The strings below are measured, one per engine, and the whole
 * value of the test is that they are quoted rather than constructed.
 */

import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { observedFromErrors } from '../src/sources/engine.js'

/** `Object.getOwnPropertyNames(caught).sort().join(',')`, per engine. */
const OWN_PROPERTIES = {
  // Chrome 152 / V8.
  chromium: 'message,stack',
  // Safari 26.5 / JavaScriptCore. Note the `stack`: V8 is not the only engine
  // that has one, which is the assumption that reported Safari as automated.
  webkit: 'column,line,message,sourceURL,stack',
  // Firefox 154 / SpiderMonkey, which keeps `stack` on the prototype.
  gecko: 'columnNumber,fileName,lineNumber,message',
}

describe('error shapes name the engine', () => {
  it.each(Object.entries(OWN_PROPERTIES))('reads %s from its own properties', (engine, own) => {
    expect(observedFromErrors({ own_properties: own })).toBe(engine)
  })

  it('does not mistake JavaScriptCore for V8 on the strength of `stack`', () => {
    // The regression. `own.includes('stack')` was true for both, so Safari
    // voted chromium twice and contradicted the engine probe's honest webkit.
    expect(observedFromErrors({ own_properties: OWN_PROPERTIES.webkit })).not.toBe('chromium')
  })

  it('lets the structural marker outvote a coincidental message length', () => {
    // JavaScriptCore embeds the failing expression's source text in the
    // message, so its lengths move with whatever the bundler named the
    // variable and can collide with V8's constants. The property shape is
    // structural and votes twice; a colliding length votes once and loses.
    expect(
      observedFromErrors({
        own_properties: OWN_PROPERTIES.webkit,
        null_property_length: 44,
      }),
    ).toBe('webkit')
  })

  it('answers nothing when it has nothing to go on', () => {
    expect(observedFromErrors({})).toBeUndefined()
  })
})

describe('under a Content-Security-Policy without unsafe-eval (WEB-10)', () => {
  it('never compiles a string, and still measures every probe', async () => {
    const { errorsSource } = await import('../src/sources/engine.js')
    const Real = globalThis.Function
    const realEval = globalThis.eval
    let attempts = 0
    // What a strict CSP does to `new Function` and `eval`: refuse them.
    const Refused = function () {
      attempts++
      throw new EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed")
    } as unknown as FunctionConstructor
    globalThis.Function = Refused
    globalThis.eval = Refused as unknown as typeof eval
    try {
      const shapes = errorsSource.run({} as Parameters<typeof errorsSource.run>[0]) as Record<string, unknown>
      expect(attempts).toBe(0)
      for (const field of [
        'null_property_length',
        'json_parse_length',
        'invalid_array_length',
        'regexp_syntax_length',
        'redefine_length',
      ]) {
        expect(shapes[field], field).toBeTypeOf('number')
      }
      expect(shapes).not.toHaveProperty('syntax_length')
      expect(shapes).not.toHaveProperty('const_assign_length')
    } finally {
      globalThis.Function = Real
      globalThis.eval = realEval
    }
  })

  it('measures the V8 lengths and votes on them', async () => {
    const { errorsSource } = await import('../src/sources/engine.js')
    const shapes = errorsSource.run({} as Parameters<typeof errorsSource.run>[0]) as Record<string, unknown>
    expect(shapes.regexp_syntax_length).toBe(51)
    expect(shapes.redefine_length).toBe(27)
    expect(observedFromErrors({ regexp_syntax_length: 51, redefine_length: 27 })).toBe('chromium')
    expect(observedFromErrors({ regexp_syntax_length: 37, redefine_length: 50 })).toBe('webkit')
  })

  it('has no string-compiling call anywhere in the source tree', () => {
    const root = new URL('../src/', import.meta.url)
    const files = readdirSync(root, { recursive: true }) as string[]
    for (const file of files.filter((name) => name.endsWith('.ts'))) {
      const text = readFileSync(new URL(file, root), 'utf8')
      expect(text, file).not.toMatch(/new Function\s*\(/)
      expect(text, file).not.toMatch(/\beval\s*\(/)
    }
  })
})
