import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpTransport, TransportError } from '../src/transport.js'
import type { IdentifySubmission } from '../src/types.js'

function submission(): IdentifySubmission {
  return {
    sdk: { platform: 'web', version: 'test' },
    signals: {
      schema: 1,
      budget_ms: 1,
      elapsed_ms: 0,
      tiers: ['fast'],
      sources: {},
      integrity: { patched_natives: [], lies: [], engine: {} },
    },
  }
}

function header(call: RequestInit | undefined, name: string): string | null {
  return new Headers(call?.headers).get(name)
}

describe('HttpTransport retry idempotency', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reuses one key and one frozen body across retry attempts', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const sent: RequestInit[] = []
    const value = submission()
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(init ?? {})
      if (sent.length === 1) {
        value.sdk.version = 'mutated-during-backoff'
        return new Response('', { status: 503 })
      }
      return new Response('{"request_id":"request-retry"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const answer = await new HttpTransport({
      apiKey: 'public-test-key', endpoint: 'https://example.test', maxAttempts: 2, fetchImpl,
    }).submit(value)

    expect(answer.request_id).toBe('request-retry')
    expect(sent).toHaveLength(2)
    expect(header(sent[0], 'Idempotency-Key')).toBeTruthy()
    expect(header(sent[1], 'Idempotency-Key')).toBe(header(sent[0], 'Idempotency-Key'))
    expect(sent[1]?.body).toBe(sent[0]?.body)
    expect(String(sent[1]?.body)).toContain('"version":"test"')
  })

  it('uses a new key for a separate submission', async () => {
    const sent: RequestInit[] = []
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(init ?? {})
      return new Response('{"request_id":"request-ok"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const transport = new HttpTransport({
      apiKey: 'public-test-key', endpoint: 'https://example.test', fetchImpl,
    })

    await transport.submit(submission())
    await transport.submit(submission())

    expect(header(sent[0], 'Idempotency-Key')).toBeTruthy()
    expect(header(sent[1], 'Idempotency-Key')).not.toBe(header(sent[0], 'Idempotency-Key'))
  })

  it('does not retry a non-retryable response', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 422 })) as typeof fetch
    const transport = new HttpTransport({
      apiKey: 'public-test-key', endpoint: 'https://example.test', maxAttempts: 3, fetchImpl,
    })

    await expect(transport.submit(submission())).rejects.toEqual(
      expect.objectContaining<Partial<TransportError>>({ status: 422, retryable: false }),
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('defaults to the Fingerly API', async () => {
    const requested: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input))
      return new Response('{"request_id":"request-1"}', { status: 200 })
    }) as typeof fetch

    await new HttpTransport({
      apiKey: 'fly_pk_production_example', fetchImpl,
    }).submit(submission())

    expect(requested).toEqual(['https://api.fingerly.io/api/v1/ingest'])
  })

  it('fails over in order with the same body and idempotency key', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (calls.length === 1) return new Response('', { status: 503 })
      return new Response('{"request_id":"request-fallback"}', { status: 200 })
    }) as typeof fetch

    await new HttpTransport({
      apiKey: 'fly_pk_production_example',
      endpoints: '/k7x2qm4a',
      fallbackToDefaultEndpoint: true,
      maxAttempts: 2,
      fetchImpl,
    }).submit(submission())

    expect(calls.map((call) => call.url)).toEqual([
      '/k7x2qm4a',
      'https://api.fingerly.io/api/v1/ingest',
    ])
    expect(calls[1]?.init?.body).toBe(calls[0]?.init?.body)
    expect(header(calls[1]?.init, 'Idempotency-Key')).toBe(header(calls[0]?.init, 'Idempotency-Key'))
  })

  it('uses no direct fallback unless explicitly requested', async () => {
    const requested: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input))
      return new Response('', { status: 503 })
    }) as typeof fetch

    await expect(new HttpTransport({
      apiKey: 'fly_pk_production_example', endpoints: '/k7x2qm4a', maxAttempts: 2, fetchImpl,
    }).submit(submission())).rejects.toBeInstanceOf(TransportError)

    expect(requested).toEqual(['/k7x2qm4a', '/k7x2qm4a'])
  })

  it('posts both calls to a custom endpoint exactly as given', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"request_id":"request-1"}')) as typeof fetch
    const transport = new HttpTransport({
      apiKey: 'fly_pk_production_example', endpoints: ['/k7x2qm4a/', 'https://edge.shop.example/q9r8'], fetchImpl,
    })
    await transport.submit(submission())
    await transport.submitSupplement('request-1', { ...submission(), token: 'continuation' })

    const calls = vi.mocked(fetchImpl).mock.calls
    expect(calls.map(([url]) => url)).toEqual(['/k7x2qm4a', '/k7x2qm4a'])
    // Nothing about the second call is in its URL; the token names the request.
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toMatchObject({ token: 'continuation' })
  })

  it('reads a bare origin as an API rather than as a proxy path', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"request_id":"request-1"}')) as typeof fetch
    const transport = new HttpTransport({
      apiKey: 'fly_pk_production_example', endpoints: ['http://localhost:8099/', 'https://api.fingerly.io'], maxAttempts: 2, fetchImpl,
    })
    await transport.submit(submission())
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe('http://localhost:8099/api/v1/ingest')
    expect(() => new HttpTransport({ apiKey: 'key', endpoints: 'https://api.fingerly.io', fallbackToDefaultEndpoint: true }))
      .not.toThrow()
  })

  it.each(['', '/', 'k7x2qm4a', '/k7?x=1', '/k7#x', 'ftp://edge.example/k7'])('rejects the endpoint %j', (endpoints) => {
    expect(() => new HttpTransport({ apiKey: 'key', endpoints })).toThrow(TypeError)
  })

  it('rejects an empty endpoint list and conflicting option spellings', () => {
    expect(() => new HttpTransport({ apiKey: 'key', endpoints: [] })).toThrow('must not be empty')
    expect(() => new HttpTransport({ apiKey: 'key', endpoint: '/old', endpoints: '/new' })).toThrow('not both')
  })

  it('sends no supplement once its signal has been aborted', async () => {
    // The client aborts this signal when consent is withdrawn. An abort
    // listener added after the fact never fires, so the loop has to look.
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const controller = new AbortController()
    controller.abort()

    await expect(new HttpTransport({ apiKey: 'key', endpoint: 'https://example.test', fetchImpl })
      .submitSupplement('request-1', { ...submission(), token: 'continuation' }, controller.signal))
      .rejects.toBeInstanceOf(TransportError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('API version configuration', () => {
  it('uses the configured version on the Fingerly API', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"request_id":"request-version"}')) as typeof fetch
    const transport = new HttpTransport({ apiKey: 'public-test-key', apiVersion: 'v2', fetchImpl })
    await transport.submit(submission())
    await transport.submitSupplement('request-version', { token: 'token', sdk: submission().sdk, signals: submission().signals })
    expect(vi.mocked(fetchImpl).mock.calls.map(([url]) => url)).toEqual([
      'https://api.fingerly.io/api/v2/ingest', 'https://api.fingerly.io/api/v2/ingest',
    ])
  })

  it.each(['', '1', 'v0', 'v2/../v1', 'v2?query', 'v2\n'])('rejects an invalid version %j', (apiVersion) => {
    expect(() => new HttpTransport({ apiKey: 'public-test-key', apiVersion })).toThrow(TypeError)
  })
})
