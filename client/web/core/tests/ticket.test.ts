import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FingerlyClient, TICKET_GRACE_MS, TICKET_MARGIN_MS } from '../src/client.js'
import { SOURCE } from '../src/signals.js'
import type { Source } from '../src/source.js'
import { HttpTransport, type SubmitResponse, type Transport } from '../src/transport.js'
import type { FreshnessTicket, IdentifySubmission, TicketRequest } from '../src/types.js'

const plain: Source = { id: SOURCE.canvas, stage: 'collect', run: () => ({ ok: true }) }

function expiresIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

function fresh(ticket: string, lifetimeMs = 300_000): FreshnessTicket {
  return { ticket, expires_at: expiresIn(lifetimeMs) }
}

function client(transport: Transport, sources: Source[] = [plain], platform?: 'android'): FingerlyClient {
  return new FingerlyClient({
    apiKey: 'fly_pk_test',
    consent: 'granted',
    sources,
    transport,
    ...(platform === undefined ? {} : { platform }),
  })
}

let askedCount = 0
/** The next of `asked1`, `asked2`, ... for one test. */
function asked(): string {
  return `asked${++askedCount}`
}

afterEach(() => {
  askedCount = 0
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('web freshness ticket (R8)', () => {
  it('starts the ticket request when collection starts, in parallel with it', async () => {
    let finishCollection!: () => void
    const collectionGate = new Promise<void>((resolve) => {
      finishCollection = resolve
    })
    const events: string[] = []
    const slow: Source = {
      id: SOURCE.canvas,
      stage: 'collect',
      run: async () => {
        events.push('collect-start')
        await collectionGate
        events.push('collect-end')
        return { ok: true }
      },
    }
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(async () => {
      events.push('ticket-request')
      return fresh('t1')
    })
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r1' }))

    const pending = client({ submit, ticket }, [slow]).identify()
    await vi.waitFor(() => expect(events).toContain('collect-start'))
    expect(ticket).toHaveBeenCalledTimes(1)
    expect(events).not.toContain('collect-end')

    finishCollection()
    await pending
    expect(events.indexOf('ticket-request')).toBeLessThan(events.indexOf('collect-end'))
    expect(submit.mock.calls[0]![0].ticket).toBe('t1')
  })

  it('asks with exactly the R8 ticket request body', async () => {
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(async () => fresh('t1'))
    await client({ submit: async () => ({ request_id: 'r1' }), ticket }).identify()
    const request: TicketRequest = ticket.mock.calls[0]![0]
    expect(request).toEqual({ v: 3, op: 'ticket', sdk: { platform: 'web', version: '0.5.3' } })
  })

  it('reuses a held next_ticket instead of asking, once', async () => {
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(async () => fresh(asked()))
    const answers: SubmitResponse[] = [
      { request_id: 'r1', next_ticket: fresh('next1') },
      { request_id: 'r2' },
      { request_id: 'r3' },
    ]
    const submit = vi.fn<Transport['submit']>(async () => answers.shift()!)
    const c = client({ submit, ticket })

    await c.identify()
    await c.identify()
    await c.identify()

    const sent = submit.mock.calls.map((call) => call[0].ticket)
    expect(sent).toEqual(['asked1', 'next1', 'asked2'])
    expect(ticket).toHaveBeenCalledTimes(2)
  })

  it('does not hand one held ticket to two concurrent reports', async () => {
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(async () => fresh(asked()))
    let first = true
    const submit = vi.fn<Transport['submit']>(async () => {
      const answer: SubmitResponse = first
        ? { request_id: 'r1', next_ticket: fresh('next1') }
        : { request_id: 'rN' }
      first = false
      return answer
    })
    const c = client({ submit, ticket })
    await c.identify()
    await Promise.all([c.identify(), c.identify()])

    const sent = submit.mock.calls.slice(1).map((call) => call[0].ticket)
    expect(sent.filter((value) => value === 'next1')).toHaveLength(1)
    expect(new Set(sent).size).toBe(2)
  })

  it('asks again when the held ticket is within the 10 second margin', async () => {
    expect(TICKET_MARGIN_MS).toBe(10_000)
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(async () => fresh('asked'))
    const answers: SubmitResponse[] = [
      { request_id: 'r1', next_ticket: fresh('almost-gone', 9_000) },
      { request_id: 'r2', next_ticket: fresh('enough-left', 60_000) },
      { request_id: 'r3' },
    ]
    const submit = vi.fn<Transport['submit']>(async () => answers.shift()!)
    const c = client({ submit, ticket })

    await c.identify()
    await c.identify()
    await c.identify()

    expect(submit.mock.calls.map((call) => call[0].ticket)).toEqual(['asked', 'asked', 'enough-left'])
    expect(ticket).toHaveBeenCalledTimes(2)
  })

  it('ignores a next_ticket that has already expired or is malformed', async () => {
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(async () => fresh('asked'))
    const answers: SubmitResponse[] = [
      { request_id: 'r1', next_ticket: { ticket: 'gone', expires_at: expiresIn(-1_000) } },
      { request_id: 'r2', next_ticket: { ticket: 'has spaces', expires_at: expiresIn(60_000) } },
      { request_id: 'r3', next_ticket: { ticket: 'ok', expires_at: 'not a date' } },
      { request_id: 'r4' },
    ]
    const submit = vi.fn<Transport['submit']>(async () => answers.shift()!)
    const c = client({ submit, ticket })
    for (let i = 0; i < 4; i++) await c.identify()
    expect(ticket).toHaveBeenCalledTimes(4)
  })

  it('sends the report without a ticket when the ticket request fails', async () => {
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r1', visitor_id: 'v1' }))
    const rejecting = client({ submit, ticket: async () => Promise.reject(new Error('down')) })
    await expect(rejecting.identify()).resolves.toMatchObject({ requestId: 'r1', visitorId: 'v1' })

    const throwing = client({
      submit,
      ticket: () => {
        throw new Error('sync')
      },
    })
    await expect(throwing.identify()).resolves.toMatchObject({ requestId: 'r1' })

    const garbage = client({ submit, ticket: async () => ({ nope: 1 }) as unknown as FreshnessTicket })
    await expect(garbage.identify()).resolves.toMatchObject({ requestId: 'r1' })

    for (const call of submit.mock.calls) expect(call[0]).not.toHaveProperty('ticket')
  })

  it('sends without a ticket when the transport cannot fetch one', async () => {
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r1' }))
    await client({ submit }).identify()
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('ticket')
  })

  it('does not wait for a slow ticket, and holds it for the next report', async () => {
    let deliver!: (value: FreshnessTicket) => void
    let calls = 0
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(() => {
      calls++
      return calls === 1
        ? new Promise<FreshnessTicket>((resolve) => {
            deliver = resolve
          })
        : Promise.resolve(fresh('second'))
    })
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r' }))
    const c = client({ submit, ticket })

    const started = Date.now()
    await c.identify()
    expect(Date.now() - started).toBeLessThan(TICKET_GRACE_MS + 1_000)
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('ticket')

    deliver(fresh('late'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await c.identify()
    expect(submit.mock.calls[1]![0].ticket).toBe('late')
    expect(ticket).toHaveBeenCalledTimes(1)
  })

  it('keeps a late requested ticket over the next_ticket that arrives after it', async () => {
    let deliver!: (value: FreshnessTicket) => void
    let release!: () => void
    const answered = new Promise<void>((resolve) => {
      release = resolve
    })
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(
      () =>
        new Promise<FreshnessTicket>((resolve) => {
          deliver = resolve
        }),
    )
    let reports = 0
    const submit = vi.fn<Transport['submit']>(async () => {
      reports++
      if (reports === 1) await answered
      // The answer's next_ticket expires later than the requested ticket.
      return { request_id: `r${reports}`, next_ticket: fresh(`next${reports}`, 300_000) }
    })
    const c = client({ submit, ticket })

    const first = c.identify()
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('ticket')
    // The requested ticket lands after the grace window, before the answer.
    deliver(fresh('requested', 200_000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await first

    await c.identify()
    expect(submit.mock.calls[1]![0].ticket).toBe('requested')
    expect(ticket).toHaveBeenCalledTimes(1)
  })

  it('keeps a late requested ticket over a next_ticket held before it', async () => {
    let deliver!: (value: FreshnessTicket) => void
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(
      () =>
        new Promise<FreshnessTicket>((resolve) => {
          deliver = resolve
        }),
    )
    const submit = vi.fn<Transport['submit']>(async () => ({
      request_id: 'r',
      next_ticket: fresh('next', 300_000),
    }))
    const c = client({ submit, ticket })

    await c.identify()
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('ticket')
    // next_ticket is already held; the requested ticket expires earlier.
    deliver(fresh('requested', 200_000))
    await new Promise((resolve) => setTimeout(resolve, 0))

    await c.identify()
    expect(submit.mock.calls[1]![0].ticket).toBe('requested')
    // The next report takes the newer next_ticket again.
    await c.identify()
    expect(submit.mock.calls[2]![0].ticket).toBe('next')
    expect(ticket).toHaveBeenCalledTimes(1)
  })

  it('takes a usable next_ticket over a requested ticket inside the margin', async () => {
    let deliver!: (value: FreshnessTicket) => void
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(
      () =>
        new Promise<FreshnessTicket>((resolve) => {
          deliver = resolve
        }),
    )
    const submit = vi.fn<Transport['submit']>(async () => ({
      request_id: 'r',
      next_ticket: fresh('next', 300_000),
    }))
    const c = client({ submit, ticket })

    await c.identify()
    deliver(fresh('requested', TICKET_MARGIN_MS - 1_000))
    await new Promise((resolve) => setTimeout(resolve, 0))

    await c.identify()
    expect(submit.mock.calls[1]![0].ticket).toBe('next')
  })

  it('still sends without waiting past the grace window for a requested ticket', async () => {
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(() => new Promise<FreshnessTicket>(() => {}))
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r' }))
    const started = Date.now()
    await client({ submit, ticket }).identify()
    expect(Date.now() - started).toBeLessThan(TICKET_GRACE_MS + 1_000)
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('ticket')
  })

  it('keeps an unsent ticket when the report never goes out', async () => {
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(async () => fresh(asked()))
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r' }))
    let revoke = true
    const revoking: Source = {
      id: SOURCE.canvas,
      stage: 'collect',
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (revoke) c.setConsent('denied')
        return { ok: true }
      },
    }
    const c = client({ submit, ticket }, [revoking])
    await expect(c.identify()).rejects.toThrow()
    expect(submit).not.toHaveBeenCalled()

    revoke = false
    c.setConsent('granted')
    await c.identify()
    expect(submit.mock.calls[0]![0].ticket).toBe('asked1')
    expect(ticket).toHaveBeenCalledTimes(1)
  })

  it('never asks for or sends a ticket on a native platform', async () => {
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(async () => fresh('t'))
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', next_ticket: fresh('n') }))
    const c = client({ submit, ticket }, [plain], 'android')
    await c.identify()
    await c.identify()
    expect(ticket).not.toHaveBeenCalled()
    for (const call of submit.mock.calls) expect(call[0]).not.toHaveProperty('ticket')
  })

  it('does not ask for a ticket on collect()', async () => {
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(async () => fresh('t'))
    await client({ submit: async () => ({ request_id: 'r' }), ticket }).collect()
    expect(ticket).not.toHaveBeenCalled()
  })

  it('writes nothing to any storage', async () => {
    const writes: string[] = []
    const storage = (name: string) => ({
      getItem: () => null,
      setItem: (key: string) => writes.push(`${name}:${key}`),
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    })
    vi.stubGlobal('localStorage', storage('local'))
    vi.stubGlobal('sessionStorage', storage('session'))
    vi.stubGlobal('indexedDB', { open: (name: string) => writes.push(`idb:${name}`) })
    vi.stubGlobal('caches', { open: async (name: string) => writes.push(`cache:${name}`) })
    const doc = {}
    Object.defineProperty(doc, 'cookie', {
      get: () => '',
      set: (value: string) => writes.push(`cookie:${value}`),
    })
    vi.stubGlobal('document', doc)

    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', next_ticket: fresh('n') }))
    const c = client({ submit, ticket: async () => fresh('t') })
    await c.identify()
    await c.identify()
    expect(submit.mock.calls.map((call) => call[0].ticket)).toEqual(['t', 'n'])
    expect(writes).toEqual([])
    // Not on the client's printable surface either.
    expect(JSON.stringify(c)).not.toContain('"n"')
  })
})

describe('HttpTransport ticket requests', () => {
  function answering(body: unknown, status = 200) {
    return vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    )
  }

  it('posts to the same path as reports, a proxy path included', async () => {
    const fetchImpl = answering({ ticket: 'abc_-9', expires_at: expiresIn(300_000) })
    const transport = new HttpTransport({
      apiKey: 'fly_pk_test',
      endpoints: '/k7x2qm4a',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const request: TicketRequest = { v: 3, op: 'ticket', sdk: { platform: 'web', version: '0.5.3' } }
    await expect(transport.ticket(request)).resolves.toMatchObject({ ticket: 'abc_-9' })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('/k7x2qm4a')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('omit')
    expect(JSON.parse(String(init?.body))).toEqual(request)
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('fly_pk_test')
  })

  it('tries the next endpoint once each, then gives up', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url === '/second'
        ? new Response(JSON.stringify({ ticket: 'ok', expires_at: expiresIn(300_000) }), { status: 200 })
        : new Response('{}', { status: 503 }),
    )
    const transport = new HttpTransport({
      apiKey: 'k',
      endpoints: ['/first', '/second'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const request: TicketRequest = { v: 3, op: 'ticket', sdk: { platform: 'web', version: '0.5.3' } }
    await expect(transport.ticket(request)).resolves.toMatchObject({ ticket: 'ok' })
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual(['/first', '/second'])

    const failing = new HttpTransport({
      apiKey: 'k',
      endpoints: ['/a', '/b'],
      fetchImpl: answering({}, 500) as unknown as typeof fetch,
    })
    await expect(failing.ticket(request)).rejects.toThrow()
  })

  it('rejects an answer without a usable ticket', async () => {
    const request: TicketRequest = { v: 3, op: 'ticket', sdk: { platform: 'web', version: '0.5.3' } }
    for (const body of [{}, { ticket: 'a b', expires_at: expiresIn(1) }, { ticket: 'ok' }]) {
      const transport = new HttpTransport({
        apiKey: 'k',
        fetchImpl: answering(body) as unknown as typeof fetch,
      })
      await expect(transport.ticket(request)).rejects.toThrow()
    }
  })
})

describe('against a local R8 mock server', () => {
  let server: Server | undefined

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = undefined
  })

  async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  }

  it('fetches, sends, and reuses tickets through one exact proxy path', async () => {
    const proxyPath = '/k7x2qm4a'
    const issued = new Set<string>()
    const used = new Set<string>()
    const outcomes: string[] = []
    let ticketRequests = 0
    let serial = 0

    const issue = (): FreshnessTicket => {
      const ticket = `tk${++serial}`
      issued.add(ticket)
      return { ticket, expires_at: new Date(Date.now() + 300_000).toISOString() }
    }

    server = createServer((request, response) => {
      void (async () => {
        const body = await readBody(request)
        response.setHeader('content-type', 'application/json')
        if (request.method !== 'POST' || request.url !== proxyPath || !request.headers['idempotency-key']) {
          response.statusCode = 404
          response.end('{}')
          return
        }
        if (body.op === 'ticket') {
          ticketRequests++
          response.end(JSON.stringify(issue()))
          return
        }
        const ticket = body.ticket
        if (typeof ticket !== 'string') outcomes.push('web_ticket_missing')
        else if (!issued.has(ticket)) outcomes.push('ticket-foreign')
        else if (used.has(ticket)) outcomes.push('ticket-reused')
        else {
          used.add(ticket)
          outcomes.push('ok')
        }
        response.end(JSON.stringify({ request_id: `req${serial}`, next_ticket: issue() }))
      })()
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo

    const c = new FingerlyClient({
      apiKey: 'fly_pk_test',
      consent: 'granted',
      sources: [plain],
      endpoints: `http://127.0.0.1:${port}${proxyPath}`,
    })
    await c.identify()
    await c.identify()
    await c.identify()

    expect(outcomes).toEqual(['ok', 'ok', 'ok'])
    expect(ticketRequests).toBe(1)
  })

  it('still identifies when the ticket path fails', async () => {
    const reports: IdentifySubmission[] = []
    server = createServer((request, response) => {
      void (async () => {
        const body = await readBody(request)
        response.setHeader('content-type', 'application/json')
        if (body.op === 'ticket') {
          response.statusCode = 503
          response.end('{}')
          return
        }
        reports.push(body as unknown as IdentifySubmission)
        response.end(JSON.stringify({ request_id: 'r1', visitor_id: 'v1' }))
      })()
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo

    const c = new FingerlyClient({
      apiKey: 'fly_pk_test',
      consent: 'granted',
      sources: [plain],
      endpoints: `http://127.0.0.1:${port}/p`,
    })
    await expect(c.identify()).resolves.toMatchObject({ visitorId: 'v1' })
    expect(reports).toHaveLength(1)
    expect(reports[0]).not.toHaveProperty('ticket')
  })
})
