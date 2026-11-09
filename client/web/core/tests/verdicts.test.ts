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
import { resetDeprecationWarnings, unansweredVerdicts, verdictsFromTriggers } from '../src/verdicts.js'
import type { Transport } from '../src/transport.js'
import type { SignalReport } from '../src/types.js'

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

describe('verdicts from the server triggers', () => {
  it('maps each signal onto the verdict it reports under', () => {
    const verdicts = verdictsFromTriggers(
      [
        { signal: 'tor', group: 'tor', confidence: 'high', reason: 'known-tor-exit' },
        { signal: 'virtual_machine', group: 'vm', confidence: 'medium', reason: 'gpu-vmware+a' },
        { signal: 'device_farm', group: 'farm', confidence: 'low', reason: 'x' },
      ],
      'high',
    )

    expect(verdicts.tor).toEqual({ value: true, confidence: 'high', reasons: ['known-tor-exit'] })
    expect(verdicts.emulator.reasons).toEqual(['gpu-vmware', 'a'])
    expect(verdicts.farm.confidence).toBe('low')
    // The server answered and said no: that is false, not nothing.
    expect(verdicts.incognito).toEqual({ value: false, confidence: 'low', reasons: [] })
  })

  it('never reports shields, because a privacy browser is not a finding', () => {
    // privacy_settings is a different question, and at most a weight-zero fact.
    const verdicts = verdictsFromTriggers(
      [{ signal: 'privacy_settings', group: 'privacy', confidence: 'high', reason: 'do-not-track-enabled' }],
      'low',
    )
    expect(verdicts.shields).toEqual({ value: null, confidence: 'low', reasons: [] })
  })

  it('reports nothing, not all clear, when the submission was not scored', () => {
    const verdicts = verdictsFromTriggers([], null)
    for (const verdict of Object.values(verdicts)) {
      expect(verdict.value).toBeNull()
      expect(verdict.reasons).toEqual([])
    }
  })

  it('never reads a trigger with an unrecognised confidence as high', () => {
    const { tor } = verdictsFromTriggers([{ signal: 'tor', group: 'tor', confidence: 'bogus', reason: 'x' }], 'low')
    expect(tor.confidence).toBe('low')
  })
})

describe('isSuspicious is the server level, nothing else', () => {
  it.each([
    ['high', true],
    ['medium', true],
    ['low', false],
    [null, null],
  ] as const)('level %s reads as %s', (level, expected) => {
    expect(isSuspiciousLevel(level)).toBe(expected)
  })
})

describe('identify() answers come from the server', () => {
  it('derives verdicts from triggers and keeps the weight out of the result', async () => {
    const result = await clientAnswering({
      suspect_score: 22,
      suspect_level: 'medium',
      triggers: [{ signal: 'automation', group: 'bot', weight: 9, confidence: 'high', reason: 'cdp-artifacts-1' }],
    }).identify({ tiers: ['fast'] })

    expect(result.suspectLevel).toBe('medium')
    expect(result.triggers).toEqual([{ signal: 'automation', group: 'bot', confidence: 'high', reason: 'cdp-artifacts-1' }])
    expect('weight' in result.triggers[0]!).toBe(false)
    expect(verdictsOf(result).automation.value).toBe(true)
    expect(verdictsOf(result).tor.value).toBe(false)
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

    expect(first.verdicts.tor.value).toBe(false)
    const second = await client.identify({ tiers: ['fast'] })
    expect(second.verdicts.tor.value).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('IdentifyResult.verdicts')
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
