/**
 * The tamper layer, tested by actually tampering.
 *
 * `findContradictions` is pure and takes reported values, so it needs no DOM at
 * all - which is the same property that lets it run again on the server.
 */

import type { SignalOutcome } from '@fingerly/core'
import { describe, expect, it } from 'vitest'

import { findContradictions } from '../src/lies/contradictions.js'

const ok = (value: unknown): SignalOutcome => ({ status: 'ok', ms: 1, value })

const CHROME_ON_MAC = {
  navigator: ok({
    user_agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    product_sub: '20030107',
    language: 'en-GB',
    languages: ['en-GB', 'en'],
    max_touch_points: 0,
  }),
  engine: ok({ observed: 'chromium', claimed: 'chromium', agrees: true }),
  // Measured on Chrome 151, so the honest case is an honest browser's numbers
  // rather than ones invented to pass.
  errors: ok({
    null_property_length: 44,
    syntax_length: 20,
    own_properties: 'message,stack',
    observed: 'chromium',
  }),
  math: ok({ hash: '4f4301d51a2d4fe6', probed: 19, identities_hold: true }),
  webgl: ok({
    unmasked_renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)',
  }),
  touch: ok({ max_touch_points: 0, touch_event: false, pointer_coarse: false, any_hover: true }),
  screen: ok({ width: 1728, height: 1117, inner_width: 1728, inner_height: 980 }),
}

const idsOf = (sources: Record<string, SignalOutcome>) =>
  findContradictions(sources).map((lie) => lie.id)

describe('findContradictions', () => {
  it('finds nothing on a consistent browser', () => {
    expect(findContradictions(CHROME_ON_MAC)).toEqual([])
  })

  it('catches two readings of the engine disagreeing with each other', () => {
    // A build that patched the RangeError lengths and the stack shape to look
    // like Chromium, and left `Error`'s own properties alone. Measured values
    // from Firefox 154 on the errors side.
    expect(
      idsOf({
        ...CHROME_ON_MAC,
        errors: ok({
          null_property_length: 33,
          syntax_length: 28,
          own_properties: 'columnNumber,fileName,lineNumber,message',
          observed: 'gecko',
        }),
      }),
    ).toContain('engine-vs-error-shapes')
  })

  it('catches error shapes that disagree with the user-agent', () => {
    // The other half of the same spoof: the engine probes were the ones
    // patched, so they agree with the claim and the error shapes agree with
    // neither.
    expect(
      idsOf({
        ...CHROME_ON_MAC,
        errors: ok({ own_properties: 'columnNumber,fileName,lineNumber,message', observed: 'gecko' }),
      }),
    ).toContain('user-agent-vs-error-shapes')
  })

  it('catches maths that misses identities exact by specification', () => {
    // What an extension that adds noise to fingerprintable APIs leaves behind.
    expect(
      idsOf({ ...CHROME_ON_MAC, math: ok({ hash: 'aaaa', probed: 19, identities_hold: false }) }),
    ).toContain('math-identities')
  })

  it('says nothing when the error shapes could not be read', () => {
    // Safari is not among the engines the error probes were measured against,
    // so `observed` is undefined there - and undefined must not be read as
    // disagreement.
    expect(idsOf({ ...CHROME_ON_MAC, errors: ok({ null_property_length: 41 }) })).toEqual([])
  })

  it('catches a user-agent that disagrees with the engine underneath it', () => {
    expect(
      idsOf({
        ...CHROME_ON_MAC,
        engine: ok({ observed: 'chromium', claimed: 'webkit', agrees: false }),
      }),
    ).toContain('user-agent-vs-engine')
  })

  it('catches a Windows user-agent on an Apple graphics stack', () => {
    // The exact move a spoofer makes: change the string, forget the stack.
    expect(
      idsOf({
        ...CHROME_ON_MAC,
        navigator: ok({
          user_agent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          platform: 'Win32',
          product_sub: '20030107',
        }),
      }),
    ).toContain('user-agent-vs-gpu')
  })

  it('catches navigator.platform disagreeing with the same user-agent', () => {
    expect(
      idsOf({
        ...CHROME_ON_MAC,
        navigator: ok({
          user_agent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          platform: 'MacIntel',
          product_sub: '20030107',
        }),
      }),
    ).toContain('user-agent-vs-platform')
  })

  it('catches touch claimed against a fine pointer that hovers', () => {
    expect(
      idsOf({
        ...CHROME_ON_MAC,
        touch: ok({
          max_touch_points: 5,
          touch_event: true,
          pointer_coarse: false,
          any_hover: true,
        }),
      }),
    ).toContain('touch-points-vs-pointer-media')
  })

  it('catches ontouchstart present with zero touch points', () => {
    expect(
      idsOf({
        ...CHROME_ON_MAC,
        touch: ok({ max_touch_points: 0, touch_event: true, pointer_coarse: true }),
      }),
    ).toContain('touch-event-vs-touch-points')
  })

  it('catches a viewport larger than its screen', () => {
    expect(
      idsOf({
        ...CHROME_ON_MAC,
        screen: ok({ width: 800, height: 600, inner_width: 1920, inner_height: 1080 }),
      }),
    ).toContain('viewport-larger-than-screen')
  })

  it('catches a productSub that no Chromium build reports', () => {
    expect(
      idsOf({
        ...CHROME_ON_MAC,
        navigator: ok({
          user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0.0.0 Safari/537.36',
          platform: 'MacIntel',
          product_sub: '20100101',
        }),
      }),
    ).toContain('product-sub')
  })

  it('catches navigator.language disagreeing with languages[0]', () => {
    expect(
      idsOf({
        ...CHROME_ON_MAC,
        navigator: ok({
          user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0.0.0 Safari/537.36',
          platform: 'MacIntel',
          product_sub: '20030107',
          language: 'de-DE',
          languages: ['en-US', 'en'],
        }),
      }),
    ).toContain('language-vs-languages')
  })

  it('stays quiet when the inputs are missing rather than guessing', () => {
    // A report where a source timed out must not produce accusations.
    expect(findContradictions({})).toEqual([])
    expect(findContradictions({ navigator: { status: 'timeout', ms: 300 } })).toEqual([])
  })

  it('does not fire on a real Android phone', () => {
    expect(
      findContradictions({
        navigator: ok({
          user_agent:
            'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
          platform: 'Linux armv81',
          product_sub: '20030107',
          language: 'en-GB',
          languages: ['en-GB', 'en'],
        }),
        engine: ok({ observed: 'chromium', claimed: 'chromium', agrees: true }),
  // Measured on Chrome 151, so the honest case is an honest browser's numbers
  // rather than ones invented to pass.
  errors: ok({
    null_property_length: 44,
    syntax_length: 20,
    own_properties: 'message,stack',
    observed: 'chromium',
  }),
  math: ok({ hash: '4f4301d51a2d4fe6', probed: 19, identities_hold: true }),
        webgl: ok({ unmasked_renderer: 'Adreno (TM) 740' }),
        touch: ok({
          max_touch_points: 5,
          touch_event: true,
          pointer_coarse: true,
          any_hover: false,
        }),
        screen: ok({ width: 412, height: 915, inner_width: 412, inner_height: 780 }),
      }),
    ).toEqual([])
  })
})
