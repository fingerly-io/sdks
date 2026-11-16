import { describe, expect, it, vi } from 'vitest'

import { FingerlyClient } from '../src/client.js'
import { DEFAULT_BUDGET_MS } from '../src/scheduler.js'
import { SOURCE } from '../src/signals.js'
import type { Source } from '../src/source.js'
import type { Transport } from '../src/transport.js'

describe('FingerlyClient single-pass v3 collection', () => {
  it('runs prerequisite before collect and submits a single v: 3 envelope', async () => {
    const order: string[] = []
    const sources: Source[] = [
      {
        id: SOURCE.engine,
        stage: 'prerequisite',
        run: (ctx) => {
          order.push('engine')
          ctx.shared?.set('gate', 'unlocked')
          return { observed: 'v8' }
        },
      },
      {
        id: SOURCE.canvas,
        stage: 'collect',
        run: (ctx) => {
          order.push('canvas')
          return {
            engineStatus: ctx.completed(SOURCE.engine)?.status,
            gate: ctx.shared?.get('gate'),
          }
        },
      },
      {
        id: SOURCE.storageDurability,
        stage: 'collect',
        optIn: 'extended-incognito',
        run: () => {
          order.push('durability')
          return { ratio: 1 }
        },
      },
    ]

    const submit = vi.fn<Transport['submit']>(async () => ({
      request_id: 'request-1',
      visitor_id: 'visitor-1',
      visitor_is_new: true,
      visitor_confidence: 0.94,
      identifiable: true,
      state: 'enriched',
      suspect_score: 7,
      suspect_level: 'low',
    }))
    const transport: Transport = { submit }

    const result = await new FingerlyClient({
      apiKey: 'public',
      consent: 'granted',
      sources,
      transport,
    }).identify({ tag: 'checkout-1' })

    expect(order).toEqual(['engine', 'canvas'])
    expect(submit).toHaveBeenCalledTimes(1)

    const sent = submit.mock.calls[0]![0]
    expect(sent).toMatchObject({
      v: 3,
      sdk: { platform: 'web', version: '0.3.0' },
      consent: 'granted',
      tag: 'checkout-1',
    })
    expect(sent).not.toHaveProperty('token')
    expect(sent).not.toHaveProperty('attest')
    expect(sent.signals).not.toHaveProperty('tiers')
    expect(sent.signals.budget_ms).toBe(DEFAULT_BUDGET_MS)
    expect(sent.signals.sources.canvas).toMatchObject({
      status: 'ok',
      value: { engineStatus: 'ok', gate: 'unlocked' },
    })
    expect(sent.signals.sources.storage_durability).toBeUndefined()

    expect(result).toMatchObject({
      requestId: 'request-1',
      visitorId: 'visitor-1',
      visitorIsNew: true,
      visitorConfidence: 0.94,
      identifiable: true,
      duplicate: false,
      state: 'enriched',
      suspectScore: 7,
      suspectLevel: 'low',
    })
    expect(result).not.toHaveProperty('deferred')
  })

  it('runs opt-in extended incognito sources only when incognitoDetection is extended', async () => {
    const sources: Source[] = [
      { id: SOURCE.storage, stage: 'collect', run: () => ({ quota: 100 }) },
      {
        id: SOURCE.storageDurability,
        stage: 'collect',
        optIn: 'extended-incognito',
        run: () => ({ ratio: 0.25, rounds: 3, honored: false }),
      },
    ]
    const transport: Transport = {
      submit: vi.fn(async () => ({ request_id: 'request-2', visitor_id: 'visitor-2', identifiable: true })),
    }
    const client = new FingerlyClient({ apiKey: 'public', consent: 'granted', sources, transport })

    const standardReport = await client.collect()
    expect(standardReport.sources.storage?.status).toBe('ok')
    expect(standardReport.sources.storage_durability).toBeUndefined()

    const extendedReport = await client.collect({ incognitoDetection: 'extended' })
    expect(extendedReport.sources.storage_durability).toMatchObject({
      status: 'ok',
      value: { ratio: 0.25, rounds: 3, honored: false },
    })
    expect(transport.submit).not.toHaveBeenCalled()

    await client.identify({ incognitoDetection: 'extended' })
    const sent = vi.mocked(transport.submit).mock.calls[0]?.[0]
    expect(sent?.signals.sources.storage_durability?.status).toBe('ok')
    expect(transport.submit).toHaveBeenCalledTimes(1)
  })

  it('maps Option B unidentifiable visitor_id "" to visitorId "", visitorIsNew false, visitorConfidence 0', async () => {
    const transport: Transport = {
      submit: vi.fn(async () => ({
        request_id: 'request-opt-b',
        visitor_id: '',
        visitor_is_new: true,
        visitor_confidence: 0.8,
        identifiable: false,
        state: 'enriched',
        suspect_score: 64,
        suspect_level: 'high',
      })),
    }

    const result = await new FingerlyClient({
      apiKey: 'public',
      consent: 'granted',
      transport,
      sources: [],
    }).identify()

    expect(result.visitorId).toBe('')
    expect(result.visitorIsNew).toBe(false)
    expect(result.visitorConfidence).toBe(0)
    expect(result.identifiable).toBe(false)
    expect(result.suspectScore).toBe(64)
    expect(result.suspectLevel).toBe('high')
  })

  it('preserves replayed visitorId, suspectScore, and suspectLevel when duplicate is true', async () => {
    const transport: Transport = {
      submit: vi.fn(async () => ({
        request_id: 'request-orig',
        duplicate: true,
        visitor_id: 'visitor-replayed',
        visitor_is_new: false,
        visitor_confidence: 0.99,
        identifiable: true,
        state: 'enriched',
        suspect_score: 18,
        suspect_level: 'medium',
      })),
    }

    const result = await new FingerlyClient({
      apiKey: 'public',
      consent: 'granted',
      transport,
      sources: [],
    }).identify()

    expect(result).toMatchObject({
      requestId: 'request-orig',
      duplicate: true,
      visitorId: 'visitor-replayed',
      visitorIsNew: false,
      visitorConfidence: 0.99,
      identifiable: true,
      suspectScore: 18,
      suspectLevel: 'medium',
    })
  })
})

describe('FingerlyClient unscored answers', () => {
  it('reports the state and no reason, which only a secret key is told', async () => {
    const transport: Transport = {
      submit: vi.fn(async () => ({
        request_id: 'request-1',
        visitor_id: 'visitor-1',
        state: 'unavailable',
        reason: 'ip-database-not-loaded',
      })),
    }
    const result = await new FingerlyClient({
      apiKey: 'public',
      consent: 'granted',
      transport,
      sources: [{ id: 'a', stage: 'collect', run: () => 1 }],
    }).identify()
    expect(result.state).toBe('unavailable')
    expect(result.suspectScore).toBeNull()
    expect('reason' in result).toBe(false)
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
    expect(pkg.version).toBe('0.3.0')
    expect(SDK_VERSION).toBe(pkg.version)
  })
})
