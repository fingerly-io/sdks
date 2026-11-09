import { describe, expect, it, vi } from 'vitest'

import { FingerlyClient } from '../src/client.js'
import { isSuspiciousLevel } from '../src/index.js'
import type { Transport } from '../src/transport.js'

function clientAnswering(answer: Record<string, unknown>): FingerlyClient {
  const transport: Transport = { submit: vi.fn(async () => ({ request_id: 'r1', ...answer })) }
  return new FingerlyClient({ apiKey: 'public', consent: 'granted', transport, sources: [] })
}

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
  it.each([
    ['a low score', { suspect_score: 3, suspect_level: 'low' }, 3, 'low', false],
    ['a high score', { suspect_score: 90, suspect_level: 'high' }, 90, 'high', true],
    ['a real zero', { suspect_score: 0, suspect_level: 'low' }, 0, 'low', false],
    ['no score', {}, null, null, null],
    ['explicit nulls', { suspect_score: null, suspect_level: null }, null, null, null],
    ['a score with its level stripped', { suspect_score: 12 }, 12, null, null],
    ['a level with its score stripped', { suspect_level: 'medium' }, null, 'medium', true],
    ['a forged score', { suspect_score: 'high', suspect_level: 7 }, null, null, null],
    ['a non-finite score', { suspect_score: Number.NaN, suspect_level: '' }, null, null, null],
  ])('%s: absent stays null', async (_name, answer, score, level, suspicious) => {
    const result = await clientAnswering(answer).identify({ tiers: ['fast'] })

    expect(result.suspectScore).toBe(score)
    expect(result.suspectLevel).toBe(level)
    expect(isSuspiciousLevel(result.suspectLevel)).toBe(suspicious)
  })

  it('never surfaces signal names, even if a proxy passes them through', async () => {
    const result = await clientAnswering({
      suspect_score: 22,
      suspect_level: 'medium',
      triggers: [{ signal: 'automation', group: 'bot', weight: 9, confidence: 'high', reason: 'cdp-artifacts-1' }],
    }).identify({ tiers: ['fast'] })

    expect(result.suspectLevel).toBe('medium')
    expect(result).not.toHaveProperty('triggers')
    expect(result).not.toHaveProperty('verdicts')
    expect(JSON.stringify({ ...result, report: undefined })).not.toContain('automation')
  })

  it('a deferred answer carries only the reports', async () => {
    const transport: Transport = {
      submit: vi.fn(async () => ({ request_id: 'r1', suspect_level: 'low', deferred_token: 'continuation' })),
      submitSupplement: vi.fn(async () => undefined),
    }
    const client = new FingerlyClient({ apiKey: 'public', consent: 'granted', transport, sources: [] })

    const deferred = await (await client.identify()).deferred

    expect(deferred.status).toBe('submitted')
    expect(deferred).not.toHaveProperty('verdicts')
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
    expect(result.suspectScore).toBeNull()
    expect(result.suspectLevel).toBeNull()
    expect(isSuspiciousLevel(result.suspectLevel)).toBeNull()
    expect(result).not.toHaveProperty('triggers')
    expect(result).not.toHaveProperty('verdicts')
    expect(result.report.sources.timing?.status).toBe('ok')
  })

  it('reports nothing for an unscored answer rather than clean', async () => {
    const result = await clientAnswering({ state: 'unavailable' }).identify({ tiers: ['fast'] })
    expect(result.suspectScore).toBeNull()
    expect(isSuspiciousLevel(result.suspectLevel)).toBeNull()
  })
})

describe('the removed exports', () => {
  it.each([
    'BRAVE_SYNTHETIC_QUOTA',
    'detectAll',
    'detectAutomation',
    'detectEmulator',
    'detectFarm',
    'detectIncognito',
    'detectShields',
    'detectTor',
    'farblesFingerprints',
    'trustedDeviceMemory',
    'unknown',
    'verdictsOf',
    'warnDeprecated',
    'weigh',
  ])('%s is gone', async (name) => {
    expect(await import('../src/index.js')).not.toHaveProperty(name)
  })
})
