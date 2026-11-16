// WEB-09: option, source and response fields are read as own properties, so a
// polluted Object.prototype changes neither what is collected, nor where the
// report is sent, nor what the result says. Nothing is sent: the transport or
// fetch is a stub.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FingerlyClient, resetEmbeddingWarning } from '../src/client.js'
import { HttpTransport } from '../src/transport.js'
import type { Source } from '../src/source.js'
import type { IdentifySubmission } from '../src/types.js'

const proto = Object.prototype as Record<string, unknown>
const polluted: string[] = []
function pollute(key: string, value: unknown) {
  proto[key] = value
  polluted.push(key)
}

const plain: Source = { id: 'plain', run: () => 1 }
const slow: Source = { id: 'slow', run: () => new Promise((r) => setTimeout(() => r(1), 60)) }
const optIn: Source = { id: 'opt', optIn: 'extended-incognito', run: () => 1 }

function client(sources: Source[], extra: Record<string, unknown> = {}) {
  const submit = vi.fn(async (_s: IdentifySubmission) => ({ request_id: 'r1' }))
  const c = new FingerlyClient({
    apiKey: 'fly_pk_development_test',
    consent: 'granted',
    sources,
    transport: { submit },
    ...extra,
  })
  return { c, submit }
}

async function run(sources: Source[] = [plain, slow, optIn], extra: Record<string, unknown> = {}) {
  const { c, submit } = client(sources, extra)
  const result = await c.identify()
  const body = submit.mock.calls[0]![0]
  return { result, body, statuses: Object.fromEntries(Object.entries(body.signals.sources).map(([k, v]) => [k, v.status])) }
}

describe('a polluted Object.prototype (WEB-09)', () => {
  afterEach(() => {
    for (const key of polluted.splice(0)) delete proto[key]
    resetEmbeddingWarning()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('baseline', async () => {
    const { result, body, statuses } = await run()
    expect(statuses).toEqual({ plain: 'ok', slow: 'ok' })
    expect('tag' in body).toBe(false)
    expect(result.suspectLevel).toBeNull()
  })

  it.each([
    ['optIn', 'extended-incognito'],
    ['incognitoDetection', 'extended'],
    ['stage', 'unknown-stage'],
    ['stages', []],
    ['budgetMs', 0],
    ['timeoutMs', 1],
    ['defaultSourceTimeoutMs', 1],
    ['concurrency', 0],
    ['filter', () => false],
  ])('%s does not change which sources run or their outcome', async (key, value) => {
    pollute(key, value)
    const { statuses, body } = await run()
    expect(statuses).toEqual({ plain: 'ok', slow: 'ok' })
    expect(body.signals.budget_ms).toBe(350)
  })

  it('tag is not attached to the submission', async () => {
    pollute('tag', 'polluted-tag')
    const { body } = await run()
    expect(Object.prototype.hasOwnProperty.call(body, 'tag')).toBe(false)
    expect(JSON.stringify(body)).not.toContain('polluted-tag')
  })

  it('response fields the server omitted stay absent', async () => {
    pollute('suspect_level', 'low')
    pollute('suspect_score', 1)
    pollute('visitor_id', 'polluted-visitor')
    pollute('identifiable', true)
    pollute('visitor_confidence', 0.99)
    pollute('visitor_is_new', true)
    pollute('duplicate', true)
    pollute('state', 'polluted')
    const { result } = await run()
    expect(result).toEqual({
      requestId: 'r1',
      visitorId: '',
      visitorIsNew: false,
      visitorConfidence: 0,
      identifiable: false,
      duplicate: false,
      state: '',
      suspectScore: null,
      suspectLevel: null,
    })
  })

  it('embeddedSafe does not let a source run inside an app', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    pollute('embeddedSafe', true)
    const { statuses } = await run([plain], { embedding: () => 'apple-webview' })
    expect(Object.keys(statuses)).toEqual(['embedding'])
  })

  it('endpoints does not redirect a default-configured client', async () => {
    const fetchStub = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ request_id: 'real' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchStub)
    pollute('endpoints', 'http://127.0.0.1:9/polluted-endpoint')
    pollute('apiVersion', 'v9')
    pollute('fallbackToDefaultEndpoint', true)
    const c = new FingerlyClient({ apiKey: 'fly_pk_development_test', consent: 'granted', sources: [plain] })
    await c.identify()
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(fetchStub.mock.calls[0]![0]).toBe('https://api.fingerly.io/api/v1/ingest')
  })

  it('maxAttempts and requestTimeoutMs do not change the transport', () => {
    pollute('maxAttempts', 99)
    pollute('requestTimeoutMs', 1)
    pollute('endpoints', 'http://127.0.0.1:9/polluted-endpoint')
    const transport = new HttpTransport({ apiKey: 'k', fetchImpl: (async () => new Response('{}')) as typeof fetch })
    expect(transport.toJSON()).toMatchObject({
      urls: ['https://api.fingerly.io/api/v1/ingest'],
      maxAttempts: 3,
      requestTimeoutMs: 5000,
    })
  })
})
