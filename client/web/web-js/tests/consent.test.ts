// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { browserSources, ConsentError, load } from '../src/index.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('consent', () => {
  it('loads with the real sources without reading the page or sending anything', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const createElement = vi.spyOn(document, 'createElement')

    const fingerly = await load({ apiKey: 'fly_pk_development_test', consent: 'pending' })

    await expect(fingerly.identify()).rejects.toBeInstanceOf(ConsentError)
    await expect(fingerly.collect()).rejects.toBeInstanceOf(ConsentError)
    expect(createElement).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('defaults to pending, so a bare load() identifies nobody', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const createElement = vi.spyOn(document, 'createElement')

    const fingerly = await load({ apiKey: 'fly_pk_development_test' })

    expect(fingerly.consent).toBe('pending')
    await expect(fingerly.identify()).rejects.toMatchObject({
      code: 'consent_required',
      state: 'pending',
    })
    expect(createElement).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends a single v: 3 submission with consent granted', async () => {
    const sources = browserSources.map((source) => ({ ...source, run: () => 1 }))
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response('{"request_id":"req_1","visitor_id":"vis_1","identifiable":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)

    const fingerly = await load({ apiKey: 'fly_pk_development_test', consent: 'granted', sources })
    const result = await fingerly.identify()
    expect(result.visitorId).toBe('vis_1')

    // One ticket request beside collection, then one report.
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toEqual({ v: 3, op: 'ticket', sdk: { platform: 'web', version: '0.5.1' } })
    expect(bodies[1]).toMatchObject({
      v: 3,
      consent: 'granted',
      sdk: { platform: 'web', version: '0.5.1' },
    })
  })

  it('runs no browser source until consent is granted', async () => {
    const runs: string[] = []
    const sources = browserSources.map((source) => ({
      ...source,
      run: () => {
        runs.push(source.id)
        return 1
      },
    }))
    const fetchImpl = vi.fn(
      async () =>
        new Response('{"request_id":"req_1","visitor_id":"vis_1"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchImpl)

    const fingerly = await load({ apiKey: 'fly_pk_development_test', consent: 'denied', sources })
    await expect(fingerly.identify()).rejects.toMatchObject({
      code: 'consent_required',
      state: 'denied',
    })
    expect(runs).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()

    fingerly.setConsent('granted')
    const result = await fingerly.identify()

    expect(result.visitorId).toBe('vis_1')
    expect(runs.length).toBeGreaterThan(0)
    // The ticket request and the report.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
