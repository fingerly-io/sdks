import { describe, expect, it } from 'vitest'

import { isSuspiciousLevel, load } from '../src/index.js'

const OLD_TRIGGER = { signal: 'automation', group: 'bot', weight: 9, confidence: 'high', reason: 'cdp-artifacts-1' }

async function identify(answer: Record<string, unknown>) {
  const client = await load({
    apiKey: 'fly_pk_development_test',
    consent: 'granted',
    sources: [],
    transport: { submit: async () => ({ request_id: 'req_public', ...answer }) },
  })
  return client.identify({ tiers: ['fast'] })
}

describe('what a public caller is told', () => {
  it.each([
    ['a score', { suspect_score: 7, suspect_level: 'low' }, 7, 'low', false],
    ['no score', {}, null, null, null],
    ['a proxy passing signals through', { suspect_score: 22, suspect_level: 'medium', triggers: [OLD_TRIGGER] }, 22, 'medium', true],
  ] as const)('%s: absent stays null and no signal is surfaced', async (_name, answer, score, level, suspicious) => {
    const result = await identify(answer)

    expect(result.requestId).toBe('req_public')
    expect(result.suspectScore).toBe(score)
    expect(result.suspectLevel).toBe(level)
    expect(isSuspiciousLevel(result.suspectLevel)).toBe(suspicious)
    expect(result).not.toHaveProperty('triggers')
    expect(result).not.toHaveProperty('verdicts')
  })
})
