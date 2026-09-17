import { describe, expect, it } from 'vitest'

import { hash64 } from '../src/hash.js'

/**
 * The published xxHash32 vectors.
 *
 * The point of testing against these rather than against whatever this
 * implementation happens to produce is the claim made in `hash.ts`: that a
 * second implementation, on Android or in Go, can be checked against the
 * algorithm instead of against this file. A golden test of our own output
 * would pass just as happily on a subtly wrong implementation, and the bug
 * would only surface as two SDKs disagreeing about the same device.
 *
 * `hash64` is two seeded passes concatenated, so the first 8 hex characters
 * are xxHash32 with seed 0 and can be compared directly.
 */
const SEED_ZERO_VECTORS: [input: string, expected: string][] = [
  ['', '02cc5d05'],
  ['a', '550d7456'],
  ['abc', '32d153ff'],
  ['message digest', '7c948494'],
  ['abcdefghijklmnopqrstuvwxyz', '63a14d5f'],
]

describe('hash64', () => {
  it.each(SEED_ZERO_VECTORS)('matches the xxHash32 vector for %j', (input, expected) => {
    expect(hash64(input).slice(0, 8)).toBe(expected)
  })

  it('returns 16 lowercase hex characters', () => {
    expect(hash64('anything')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('uses both halves, so the two seeds actually differ', () => {
    const digest = hash64('abc')
    expect(digest.slice(0, 8)).not.toBe(digest.slice(8))
  })

  it('is stable across calls', () => {
    expect(hash64('stability')).toBe(hash64('stability'))
  })

  it('separates inputs that differ only in a late byte', () => {
    // The 16-byte block loop is the part most likely to be wrong, so the
    // inputs here straddle it rather than being short.
    const a = 'the quick brown fox jumps over the lazy dog'
    const b = 'the quick brown fox jumps over the lazy dov'
    expect(hash64(a)).not.toBe(hash64(b))
  })

  it('hashes bytes and the equivalent string identically', () => {
    const text = 'utf8 ✓ multibyte'
    expect(hash64(new TextEncoder().encode(text))).toBe(hash64(text))
  })
})
