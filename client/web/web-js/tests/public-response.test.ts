import { describe, expect, it } from 'vitest'

import { isSuspiciousLevel, load, verdictsOf } from '../src/index.js'

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
    ['score and no triggers', { suspect_score: 7, suspect_level: 'low' }, 7, 'low', false, 0],
    ['neither score nor triggers', {}, null, null, null, 0],
    ['an old shape with triggers', { suspect_score: 22, suspect_level: 'medium', triggers: [OLD_TRIGGER] }, 22, 'medium', true, 1],
  ] as const)('%s: absent stays null and verdicts report nothing', async (_name, answer, score, level, suspicious, triggers) => {
    const result = await identify(answer)

    expect(result.requestId).toBe('req_public')
    expect(result.suspectScore).toBe(score)
    expect(result.suspectLevel).toBe(level)
    expect(isSuspiciousLevel(result.suspectLevel)).toBe(suspicious)
    expect(result.triggers).toHaveLength(triggers)
    for (const verdict of Object.values(verdictsOf(result))) expect(verdict.value).toBeNull()
  })
})
