import { afterEach, describe, expect, it, vi } from 'vitest'

import { FingerlyClient } from '../src/client.js'
import {
  BRAVE_SYNTHETIC_QUOTA,
  detectAll,
  detectAutomation,
  detectEmulator,
  detectFarm,
  detectIncognito,
  detectShields,
  detectTor,
  farblesFingerprints,
  isSuspiciousLevel,
  trustedDeviceMemory,
  unknown,
  verdictsOf,
  warnDeprecated,
  weigh,
} from '../src/index.js'
import { resetDeprecationWarnings, unansweredVerdicts } from '../src/verdicts.js'
import type { Transport } from '../src/transport.js'
import type { IdentifyResult, SignalReport } from '../src/types.js'

// A browser report the old local detectors would have fired on: a clamped
// clock and a software renderer. The stubs must ignore it entirely.
const SUSPICIOUS_REPORT: SignalReport = {
  schema: 1,
  budget_ms: 1200,
  elapsed_ms: 40,
  tiers: ['fast', 'deferred'],
  sources: {
    timing: { status: 'ok', ms: 1, value: { now_resolution: 100 } },
    webgl: { status: 'ok', ms: 1, value: { unmasked_renderer: 'SwiftShader' } },
  },
  integrity: { patched_natives: ['a', 'b'], lies: [], engine: {} },
}

function clientAnswering(answer: Record<string, unknown>): FingerlyClient {
  const transport: Transport = { submit: vi.fn(async () => ({ request_id: 'r1', ...answer })) }
  return new FingerlyClient({ apiKey: 'public', consent: 'granted', transport, sources: [] })
}

afterEach(() => {
  resetDeprecationWarnings()
  vi.restoreAllMocks()
})

describe('isSuspicious is the server level, nothing else', () => {
  it.each([
    ['high', true],
    ['medium', true],
    ['low', false],
    [null, null],
    [undefined, null],
    ['', null],
    // A level this version has never heard of is not a clean result.
    ['critical', null],
  ] as const)('level %s reads as %s', (level, expected) => {
    expect(isSuspiciousLevel(level)).toBe(expected)
  })
})

describe('identify() answers come from the server', () => {
  const nothing = { value: null, confidence: 'low', reasons: [] }
  const expectNoVerdicts = (result: IdentifyResult) => {
    for (const verdict of Object.values(verdictsOf(result))) expect(verdict).toEqual(nothing)
  }

  it.each([
    ['a low score and no triggers', { suspect_score: 3, suspect_level: 'low' }, 3, 'low', false],
    ['a high score and no triggers', { suspect_score: 90, suspect_level: 'high' }, 90, 'high', true],
    ['a real zero', { suspect_score: 0, suspect_level: 'low' }, 0, 'low', false],
    ['neither score nor triggers', {}, null, null, null],
    ['explicit nulls', { suspect_score: null, suspect_level: null, triggers: null }, null, null, null],
    ['a score with its level stripped', { suspect_score: 12 }, 12, null, null],
    ['a level with its score stripped', { suspect_level: 'medium' }, null, 'medium', true],
    ['a forged score', { suspect_score: 'high', suspect_level: 7 }, null, null, null],
    ['a non-finite score', { suspect_score: Number.NaN, suspect_level: '' }, null, null, null],
  ])('%s: absent stays null and verdicts hold nothing', async (_name, answer, score, level, suspicious) => {
    const result = await clientAnswering(answer).identify({ tiers: ['fast'] })

    expect(result.suspectScore).toBe(score)
    expect(result.suspectLevel).toBe(level)
    expect(isSuspiciousLevel(result.suspectLevel)).toBe(suspicious)
    expect(result.triggers).toEqual([])
    expectNoVerdicts(result)
  })

  it('an old-shape response keeps its triggers, without the weight, and never reports a verdict', async () => {
    const result = await clientAnswering({
      suspect_score: 22,
      suspect_level: 'medium',
      triggers: [{ signal: 'automation', group: 'bot', weight: 9, confidence: 'high', reason: 'cdp-artifacts-1' }],
    }).identify({ tiers: ['fast'] })

    expect(result.suspectLevel).toBe('medium')
    expect(result.triggers).toEqual([{ signal: 'automation', group: 'bot', confidence: 'high', reason: 'cdp-artifacts-1' }])
    expect('weight' in result.triggers![0]!).toBe(false)
    // Not true for the signal that fired, and above all not false for the rest.
    expectNoVerdicts(result)
  })

  it.each([
    ['a string', 'automation'],
    ['an object', { signal: 'automation' }],
    ['holes and junk', [null, 7, 'x', {}, { signal: 1 }]],
  ])('malformed triggers (%s) read as none rather than throwing', async (_name, triggers) => {
    const result = await clientAnswering({ triggers }).identify({ tiers: ['fast'] })
    expect(result.triggers).toEqual([])
  })

  it('a deferred answer carries the same empty verdicts', async () => {
    const transport: Transport = {
      submit: vi.fn(async () => ({ request_id: 'r1', suspect_level: 'low', deferred_token: 'continuation' })),
      submitSupplement: vi.fn(async () => undefined),
    }
    const client = new FingerlyClient({ apiKey: 'public', consent: 'granted', transport, sources: [] })

    const deferred = await (await client.identify()).deferred

    expect(deferred.status).toBe('submitted')
    if (deferred.status !== 'submitted') return
    for (const verdict of Object.values(deferred.verdicts)) expect(verdict).toEqual(nothing)
  })

  it('a plain verdicts field on a hand-built result is not read', () => {
    const forged = { verdicts: { tor: { value: false, confidence: 'high', reasons: [] } } } as unknown as IdentifyResult
    expectNoVerdicts(forged)
  })

  it('submit: false returns only the raw report, and no false clean', async () => {
    const transport: Transport = { submit: vi.fn() }
    const client = new FingerlyClient({
      apiKey: 'public',
      consent: 'granted',
      transport,
      // A source reporting a clamped clock. Nothing local may read it.
      sources: [{ id: 'timing', tier: 'fast', run: () => ({ now_resolution: 100 }) }],
    })

    const result = await client.identify({ submit: false })

    expect(transport.submit).not.toHaveBeenCalled()
    expect(result.suspectLevel).toBeNull()
    expect(result.triggers).toEqual([])
    expect(result.report.sources.timing?.status).toBe('ok')
    for (const verdict of Object.values(verdictsOf(result))) {
      expect(verdict.value).toBeNull()
    }
  })

  it('reports nothing for an unscored answer rather than clean', async () => {
    const result = await clientAnswering({ state: 'unavailable' }).identify({ tiers: ['fast'] })
    expect(result.suspectScore).toBeNull()
    expect(verdictsOf(result).automation.value).toBeNull()
  })

  it('warns once per page when the deprecated field is read, and not when a binding copies it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = clientAnswering({ suspect_level: 'low' })

    const first = await client.identify({ tiers: ['fast'] })
    verdictsOf(first)
    expect(warn).not.toHaveBeenCalled()

    expect(first.verdicts.tor.value).toBeNull()
    const second = await client.identify({ tiers: ['fast'] })
    expect(second.verdicts.tor.value).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('IdentifyResult.verdicts')
    expect(String(warn.mock.calls[0]?.[0])).toContain('read signals on your backend')
  })
})

describe('the deprecated exports', () => {
  const allStubs = [detectAutomation, detectEmulator, detectFarm, detectIncognito, detectShields, detectTor]

  it.each(allStubs.map((fn) => [fn.name, fn] as const))('%s ignores its input and answers nothing', (_name, stub) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(stub(SUSPICIOUS_REPORT)).toEqual({ value: null, confidence: 'low', reasons: [] })
  })

  it('detectAll answers nothing for every verdict, not clean', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const all = detectAll(SUSPICIOUS_REPORT)
    expect(Object.keys(all).sort()).toEqual(['automation', 'emulator', 'farm', 'incognito', 'shields', 'tor'])
    for (const verdict of Object.values(all)) expect(verdict.value).toBeNull()
  })

  it('weigh and unknown keep their shape and compute nothing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(weigh([{ reason: 'x', weight: 5 }], 1)).toEqual({ value: null, confidence: 'low', reasons: [] })
    expect(unknown()).toEqual({ value: null, confidence: 'low', reasons: [] })
  })

  it('the small helpers are importable and inert', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(farblesFingerprints(SUSPICIOUS_REPORT)).toBe(false)
    expect(trustedDeviceMemory(SUSPICIOUS_REPORT)).toBeUndefined()
    expect(typeof BRAVE_SYNTHETIC_QUOTA).toBe('number')
  })

  it('warns once per key, not once per call', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    detectTor(SUSPICIOUS_REPORT)
    detectTor(SUSPICIOUS_REPORT)
    expect(warn).toHaveBeenCalledTimes(1)
    warnDeprecated('something-else', 'a message')
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('stays silent in a production build', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      detectTor(SUSPICIOUS_REPORT)
    } finally {
      process.env.NODE_ENV = before
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('unansweredVerdicts is a fresh object each time', () => {
    const a = unansweredVerdicts()
    const b = unansweredVerdicts()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    a.tor.reasons.push('x')
    expect(b.tor.reasons).toEqual([])
  })
})
