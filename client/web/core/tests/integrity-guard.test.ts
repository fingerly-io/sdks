// WEB-04: a tamper layer that throws (for example on a page getter replaced by
// an earlier script) is recorded as a lie and never rejects identify().

import { describe, expect, it, vi } from 'vitest'

import { FingerlyClient } from '../src/client.js'
import type { IdentifySubmission } from '../src/types.js'

describe('the integrity pass', () => {
  it('records a throwing inspection as a lie and still submits', async () => {
    const submit = vi.fn(async (_s: IdentifySubmission) => ({ request_id: 'r1' }))
    const client = new FingerlyClient({
      apiKey: 'fly_pk_development_test',
      consent: 'granted',
      sources: [{ id: 'plain', run: () => 1 }],
      transport: { submit },
      integrity: () => {
        throw new Error('getter threw')
      },
    })

    const result = await client.identify()
    expect(result.requestId).toBe('r1')
    expect(submit).toHaveBeenCalledTimes(1)
    const body = submit.mock.calls[0]![0]
    expect(body.signals.sources.plain?.status).toBe('ok')
    expect(body.signals.integrity).toEqual({
      patched_natives: [],
      lies: [{ id: 'integrity', kind: 'unverified_realm', detail: 'inspection-threw' }],
      engine: {},
    })
  })

  it('does not return the report from identify() (WEB-14)', async () => {
    const client = new FingerlyClient({
      apiKey: 'fly_pk_development_test',
      consent: 'granted',
      sources: [{ id: 'plain', run: () => 1 }],
      transport: { submit: async () => ({ request_id: 'r1' }) },
    })
    const result = await client.identify()
    expect('report' in result).toBe(false)
    const report = await client.collect()
    expect(report.sources.plain?.status).toBe('ok')
  })
})
