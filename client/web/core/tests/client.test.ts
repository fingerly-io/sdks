import { describe, expect, it, vi } from 'vitest'

import { FingerlyClient } from '../src/client.js'
import type { Source } from '../src/source.js'
import type { Transport } from '../src/transport.js'

describe('FingerlyClient deferred collection', () => {
  it('returns the authoritative first response and exposes tracked deferred completion', async () => {
    const order: string[] = []
    let releaseDeferred!: () => void
    const deferredGate = new Promise<void>((resolve) => { releaseDeferred = resolve })
    const sources: Source[] = [
      { id: 'fast-one', tier: 'fast', run: () => { order.push('fast'); return 1 } },
      { id: 'canvas', tier: 'deferred', run: async (ctx) => { await deferredGate; order.push('deferred'); return ctx.completed('fast-one')?.status } },
    ]
    const submitSupplement = vi.fn(async () => {})
    const transport: Transport = {
      submit: vi.fn(async () => ({
        request_id: 'request-1', visitor_id: 'visitor-1', suspect_score: 7,
        suspect_level: 'low', deferred_token: 'continuation',
      })),
      submitSupplement,
    }
    const result = await new FingerlyClient({ apiKey: 'public', consent: 'granted', sources, transport }).identify()

    expect(order).toEqual(['fast'])
    expect(result).toMatchObject({ requestId: 'request-1', visitorId: 'visitor-1', suspectScore: 7 })
    expect(result.report.tiers).toEqual(['fast'])

    releaseDeferred()
    const deferred = await result.deferred
    expect(order).toEqual(['fast', 'deferred'])
    expect(deferred.status).toBe('submitted')
    expect(submitSupplement).toHaveBeenCalledWith(
      'request-1',
      expect.objectContaining({ token: 'continuation', signals: expect.objectContaining({ tiers: ['deferred'] }) }),
      expect.any(AbortSignal),
    )
  })

  it('collects both tiers locally and never starts a network supplement', async () => {
    const transport: Transport = { submit: vi.fn() }
    const result = await new FingerlyClient({
      apiKey: 'public', consent: 'granted', transport,
      sources: [
        { id: 'a', tier: 'fast', run: () => 1 },
        { id: 'b', tier: 'deferred', run: () => 2 },
      ],
    }).identify({ submit: false })
    expect(result.report.tiers).toEqual(['fast', 'deferred'])
    expect(await result.deferred).toEqual({ status: 'skipped', reason: 'not-submitted' })
    expect(transport.submit).not.toHaveBeenCalled()
  })
})

describe('FingerlyClient printing', () => {
  it('never shows the key in JSON or inspection', async () => {
    const { inspect } = await import('node:util')
    const client = new FingerlyClient({ apiKey: 'fly_pk_development_secretvalue', endpoints: '/k7x2qm4a' })
    expect(JSON.stringify(client)).not.toContain('secretvalue')
    expect(inspect(client, { depth: 6, showHidden: true })).not.toContain('secretvalue')
    expect(JSON.stringify(client)).toContain('[redacted]')
  })
})

describe('reported version', () => {
  it('matches the package version, which is what support asks a customer for', async () => {
    const { readFileSync } = await import('node:fs')
    const { SDK_VERSION } = await import('../src/version.js')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(SDK_VERSION).toBe(pkg.version)
  })
})
