import { describe, expect, it } from 'vitest'

import { canonicalize } from '../src/canonical.js'

describe('canonicalize', () => {
  it('sorts object keys, so insertion order cannot change the output', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }))
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('sorts nested keys too', () => {
    const one = canonicalize({ outer: { z: 1, a: { y: 2, b: 3 } } })
    const two = canonicalize({ outer: { a: { b: 3, y: 2 }, z: 1 } })
    expect(one).toBe(two)
  })

  it('preserves array order, which is data rather than layout', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]))
  })

  it('distinguishes the non-finite numbers JSON.stringify flattens to null', () => {
    // A NaN from a maths source and a genuinely absent value are different
    // observations; JSON.stringify renders both as `null`.
    expect(canonicalize(Number.NaN)).toBe('"@NaN"')
    expect(canonicalize(Infinity)).toBe('"@Infinity"')
    expect(canonicalize(-Infinity)).toBe('"@-Infinity"')
    expect(canonicalize(null)).toBe('null')

    expect(canonicalize(Number.NaN)).not.toBe(canonicalize(null))
  })

  it('distinguishes negative zero', () => {
    expect(canonicalize(-0)).toBe('"@-0"')
    expect(canonicalize(0)).toBe('0')
  })

  it('drops undefined object values, matching exactOptionalPropertyTypes', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }))
  })

  it('keeps an array hole in place, because its index is meaningful', () => {
    expect(canonicalize([1, undefined, 3])).toBe('[1,null,3]')
  })

  it('escapes keys and strings', () => {
    expect(canonicalize({ 'a"b': 'c\\d' })).toBe('{"a\\"b":"c\\\\d"}')
  })

  it('does not throw on a value a buggy source should never have returned', () => {
    expect(canonicalize({ fn: () => 1, sym: Symbol('x'), ok: 1 })).toBe(
      '{"fn":null,"ok":1,"sym":null}',
    )
  })

  it('serialises bigint as a string rather than throwing', () => {
    expect(canonicalize({ n: 10n })).toBe('{"n":"10"}')
  })
})
