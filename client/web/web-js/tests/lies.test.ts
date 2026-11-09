/**
 * The tamper layer's report is raw.
 *
 * Whether the reported values contradict each other - a user agent claiming a
 * phone that hovers, a language that is not the first of its own languages - is
 * the server's reading of the same sources, so the page no longer computes or
 * sends it. These tests pin that the report stays measurements only. The cases
 * that used to live here moved with the logic, to the server's table test
 * `TestBrowserContradictionsPortedCases` in domain/risk.
 */

import type { SignalOutcome } from '@fingerly/core'
import { describe, expect, it, vi } from 'vitest'

import { inspectIntegrity } from '../src/lies/index.js'

const ok = (value: unknown): SignalOutcome => ({ status: 'ok', ms: 1, value })

// A report that would have produced several contradictions: a Windows claim on
// an Apple graphics stack, and a language that is not its own languages' first.
const CONTRADICTORY = {
  navigator: ok({
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    product_sub: '20100101',
    language: 'de-DE',
    languages: ['en-US'],
  }),
  engine: ok({ observed: 'chromium', claimed: 'webkit' }),
  errors: ok({ observed: 'gecko' }),
  webgl: ok({ unmasked_renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro)' }),
  screen: ok({ width: 800, inner_width: 1920 }),
  math: ok({ identities_hold: false }),
}

describe('inspectIntegrity reports measurements only', () => {
  it('computes no contradiction from sources that disagree', () => {
    // Outside a window, so no native or descriptor probes run either, and
    // lies is exactly what would be left of a contradiction layer: nothing.
    vi.stubGlobal('window', undefined)
    try {
      const report = inspectIntegrity(CONTRADICTORY)
      expect(report.lies).toEqual([])
      expect(report.patched_natives).toEqual([])
      expect(JSON.stringify(report)).not.toContain('contradiction')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports the engine identity raw, with no agreement field', () => {
    vi.stubGlobal('window', undefined)
    try {
      const { engine } = inspectIntegrity(CONTRADICTORY)
      expect(engine).toEqual({ observed: 'chromium', claimed: 'webkit' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
