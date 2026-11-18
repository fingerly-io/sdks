import { afterEach, describe, expect, it, vi } from 'vitest'

import { FingerlyClient } from '../src/client.js'
import { ConsentError } from '../src/consent.js'
import { SEAL_MARGIN_MS, SEAL_STORAGE_KEY } from '../src/continuity.js'
import { SOURCE } from '../src/signals.js'
import type { Source } from '../src/source.js'
import { HttpTransport, readSeal, type SubmitResponse, type Transport } from '../src/transport.js'
import type {
  ConsentState,
  Continuity,
  FreshnessTicket,
  IdentifySubmission,
  SessionSeal,
} from '../src/types.js'

const plain: Source = { id: SOURCE.canvas, stage: 'collect', run: () => ({ ok: true }) }

function expiresIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

/** A seal as an answer carries it, good for 30 minutes unless told otherwise. */
function sealed(seal: string, lifetimeMs = 30 * 60_000): SessionSeal {
  return { seal, expires_at: expiresIn(lifetimeMs) }
}

function fresh(ticket: string): FreshnessTicket {
  return { ticket, expires_at: expiresIn(300_000) }
}

interface ClientInput {
  continuity?: Continuity
  consent?: ConsentState
  platform?: 'android'
}

function client(transport: Transport, input: ClientInput = {}): FingerlyClient {
  return new FingerlyClient({
    apiKey: 'fly_pk_test',
    consent: input.consent ?? 'granted',
    sources: [plain],
    transport,
    ...(input.continuity === undefined ? {} : { continuity: input.continuity }),
    ...(input.platform === undefined ? {} : { platform: input.platform }),
  })
}

/** A `Storage` that records every call made to it. */
function recordingStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  const calls: string[] = []
  const storage = {
    getItem: (key: string) => {
      calls.push(`get:${key}`)
      return items.has(key) ? items.get(key)! : null
    },
    setItem: (key: string, value: string) => {
      calls.push(`set:${key}`)
      items.set(key, String(value))
    },
    removeItem: (key: string) => {
      calls.push(`remove:${key}`)
      items.delete(key)
    },
    clear: () => {
      calls.push('clear')
      items.clear()
    },
    key: (index: number) => {
      calls.push(`key:${index}`)
      return [...items.keys()][index] ?? null
    },
    get length() {
      calls.push('length')
      return items.size
    },
  }
  return { storage, items, calls }
}

function stubSession(initial: Record<string, string> = {}) {
  const session = recordingStorage(initial)
  vi.stubGlobal('sessionStorage', session.storage)
  return session
}

function stored(seal: SessionSeal): Record<string, string> {
  return { [SEAL_STORAGE_KEY]: JSON.stringify(seal) }
}

/** Replaces `globalThis.sessionStorage` with a getter, and puts it back. */
async function withSessionStorageGetter(get: () => unknown, run: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get })
  try {
    await run()
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original)
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage
  }
}

function sentFields(submit: { mock: { calls: [IdentifySubmission, ...unknown[]][] } }) {
  return submit.mock.calls.map(([submission]) => ({
    continuity: submission.continuity,
    seal: submission.seal,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the continuity option', () => {
  const transport: Transport = { submit: async () => ({ request_id: 'r' }) }

  it("accepts 'none' and 'session' and nothing else", () => {
    expect(() => client(transport, { continuity: 'none' })).not.toThrow()
    expect(() => client(transport, { continuity: 'session' })).not.toThrow()
    for (const value of [true, false, 1, '', 'tab', 'Session', 'persistent', {}]) {
      expect(() => client(transport, { continuity: value as unknown as Continuity })).toThrow(TypeError)
    }
    expect(() => client(transport, { continuity: 'tab' as unknown as Continuity })).toThrow(
      `Fingerly continuity must be 'none' or 'session' (received "tab")`,
    )
  })

  it('does not take a mode from a polluted Object.prototype', async () => {
    const session = stubSession()
    const prototype = Object.prototype as { continuity?: unknown }
    prototype.continuity = 'session'
    try {
      const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', next_seal: sealed('s1') }))
      const c = new FingerlyClient({
        apiKey: 'fly_pk_test',
        consent: 'granted',
        sources: [plain],
        transport: { submit },
      })
      await c.identify()
      expect(Object.keys(submit.mock.calls[0]![0])).not.toContain('continuity')
      expect(Object.keys(submit.mock.calls[0]![0])).not.toContain('seal')
      expect(session.calls).toEqual([])
    } finally {
      delete prototype.continuity
    }
  })
})

describe("continuity 'none', the default", () => {
  for (const continuity of [undefined, 'none'] as const) {
    it(`sends no field and touches no storage (${continuity ?? 'option left out'})`, async () => {
      const held = JSON.stringify(sealed('held'))
      const session = stubSession({ [SEAL_STORAGE_KEY]: held })
      const local = recordingStorage()
      vi.stubGlobal('localStorage', local.storage)

      const submit = vi.fn<Transport['submit']>(async () => ({
        request_id: 'r',
        next_seal: sealed('offered'),
      }))
      const c = client({ submit, ticket: async () => fresh('t') }, continuity ? { continuity } : {})
      await c.identify()
      await c.identify()
      c.setConsent('denied')

      for (const [submission] of submit.mock.calls) {
        expect(submission).not.toHaveProperty('continuity')
        expect(submission).not.toHaveProperty('seal')
      }
      // Not a read, not a write, not a removal.
      expect(session.calls).toEqual([])
      expect(local.calls).toEqual([])
      expect(session.items.get(SEAL_STORAGE_KEY)).toBe(held)
    })
  }
})

describe("continuity 'session'", () => {
  it('asks for a seal on every report, stores next_seal and sends it on the next', async () => {
    const session = stubSession()
    const first = sealed('seal-1')
    const second = sealed('seal-2')
    const answers: SubmitResponse[] = [
      { request_id: 'r1', next_seal: first },
      { request_id: 'r2', next_seal: second },
      { request_id: 'r3', next_seal: sealed('seal-3') },
    ]
    const submit = vi.fn<Transport['submit']>(async () => answers.shift()!)
    const c = client({ submit }, { continuity: 'session' })

    await c.identify()
    expect(session.items.get(SEAL_STORAGE_KEY)).toBe(JSON.stringify(first))
    await c.identify()
    expect(session.items.get(SEAL_STORAGE_KEY)).toBe(JSON.stringify(second))
    await c.identify()

    expect(sentFields(submit)).toEqual([
      { continuity: 'session', seal: undefined },
      { continuity: 'session', seal: 'seal-1' },
      { continuity: 'session', seal: 'seal-2' },
    ])
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('seal')
    expect([...session.items.keys()]).toEqual([SEAL_STORAGE_KEY])
  })

  it('uses the one key __fingerly_seal__ and stores only the seal and its expiry', async () => {
    expect(SEAL_STORAGE_KEY).toBe('__fingerly_seal__')
    const session = stubSession()
    const next = { ...sealed('seal-1'), visitor_id: 'v1', extra: { nested: true } }
    const submit = vi.fn<Transport['submit']>(async () => ({
      request_id: 'r1',
      visitor_id: 'v1',
      next_seal: next as SessionSeal,
    }))
    await client({ submit }, { continuity: 'session' }).identify()
    expect(JSON.parse(session.items.get(SEAL_STORAGE_KEY)!)).toEqual({
      seal: 'seal-1',
      expires_at: next.expires_at,
    })
    expect(session.calls.filter((call) => call.startsWith('set:'))).toEqual([`set:${SEAL_STORAGE_KEY}`])
  })

  it('picks up a seal another client in the same tab stored', async () => {
    stubSession()
    const answers: SubmitResponse[] = [{ request_id: 'r1', next_seal: sealed('seal-1') }, { request_id: 'r2' }]
    const submit = vi.fn<Transport['submit']>(async () => answers.shift()!)
    await client({ submit }, { continuity: 'session' }).identify()
    await client({ submit }, { continuity: 'session' }).identify()
    expect(submit.mock.calls[1]![0].seal).toBe('seal-1')
  })

  it('removes an expired stored seal and does not send it', async () => {
    expect(SEAL_MARGIN_MS).toBe(10_000)
    for (const lifetimeMs of [-60_000, 0, SEAL_MARGIN_MS - 1_000]) {
      const session = stubSession(stored(sealed('old', lifetimeMs)))
      let present: boolean | undefined
      const submit = vi.fn<Transport['submit']>(async () => {
        present = session.items.has(SEAL_STORAGE_KEY)
        return { request_id: 'r', next_seal: sealed('renewed') }
      })
      await client({ submit }, { continuity: 'session' }).identify()

      expect(submit.mock.calls[0]![0]).not.toHaveProperty('seal')
      expect(submit.mock.calls[0]![0].continuity).toBe('session')
      // Gone before the report went out, not only replaced by the answer.
      expect(present).toBe(false)
      vi.unstubAllGlobals()
    }
  })

  it('sends a stored seal that has more than the margin left', async () => {
    stubSession(stored(sealed('held', SEAL_MARGIN_MS + 5_000)))
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r' }))
    await client({ submit }, { continuity: 'session' }).identify()
    expect(submit.mock.calls[0]![0].seal).toBe('held')
  })

  it('removes a malformed stored value and does not send it', async () => {
    const future = expiresIn(60 * 60_000)
    const malformed: string[] = [
      'not json',
      '',
      'null',
      '"seal-as-a-string"',
      '42',
      '[]',
      JSON.stringify([{ seal: 'abc', expires_at: future }]),
      JSON.stringify({}),
      JSON.stringify({ seal: 'abc' }),
      JSON.stringify({ expires_at: future }),
      JSON.stringify({ seal: 42, expires_at: future }),
      JSON.stringify({ seal: 'abc', expires_at: 1_900_000_000 }),
      JSON.stringify({ seal: '', expires_at: future }),
      JSON.stringify({ seal: 'has spaces', expires_at: future }),
      JSON.stringify({ seal: 'padded==', expires_at: future }),
      JSON.stringify({ seal: 'std+base64/', expires_at: future }),
      JSON.stringify({ seal: 'a'.repeat(257), expires_at: future }),
      JSON.stringify({ seal: 'abc', expires_at: 'not a date' }),
      JSON.stringify({ seal: 'abc', expires_at: future, padding: 'x'.repeat(4096) }),
    ]
    for (const value of malformed) {
      const session = stubSession({ [SEAL_STORAGE_KEY]: value })
      let present: boolean | undefined
      const submit = vi.fn<Transport['submit']>(async () => {
        present = session.items.has(SEAL_STORAGE_KEY)
        return { request_id: 'r', next_seal: sealed('renewed') }
      })
      await expect(client({ submit }, { continuity: 'session' }).identify()).resolves.toMatchObject({
        requestId: 'r',
      })
      expect(submit.mock.calls[0]![0], value).not.toHaveProperty('seal')
      expect(present, value).toBe(false)
      vi.unstubAllGlobals()
    }
  })

  it('accepts a stored seal of exactly 256 characters', async () => {
    const longest = 'A'.repeat(256)
    stubSession(stored(sealed(longest)))
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r' }))
    await client({ submit }, { continuity: 'session' }).identify()
    expect(submit.mock.calls[0]![0].seal).toBe(longest)
  })

  it('clears the stored seal when the answer carries no next_seal', async () => {
    const session = stubSession(stored(sealed('held')))
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', visitor_id: 'v1' }))
    const c = client({ submit }, { continuity: 'session' })

    await c.identify()
    expect(submit.mock.calls[0]![0].seal).toBe('held')
    expect(session.items.has(SEAL_STORAGE_KEY)).toBe(false)

    await c.identify()
    expect(submit.mock.calls[1]![0]).not.toHaveProperty('seal')
    expect(submit.mock.calls[1]![0].continuity).toBe('session')
  })

  it('clears the stored seal when next_seal is unusable', async () => {
    const future = expiresIn(60 * 60_000)
    const unusable: unknown[] = [
      null,
      'seal',
      { seal: 'has spaces', expires_at: future },
      { seal: 'a'.repeat(257), expires_at: future },
      { seal: 'ok', expires_at: 'not a date' },
      { seal: 'ok' },
      sealed('gone', -1_000),
      sealed('nearly', SEAL_MARGIN_MS - 1_000),
      Object.create({ seal: 'inherited', expires_at: future }),
    ]
    for (const next of unusable) {
      const session = stubSession(stored(sealed('held')))
      const submit = vi.fn<Transport['submit']>(async () => ({
        request_id: 'r',
        next_seal: next as SessionSeal,
      }))
      await client({ submit }, { continuity: 'session' }).identify()
      expect(session.items.has(SEAL_STORAGE_KEY), JSON.stringify(next)).toBe(false)
      vi.unstubAllGlobals()
    }
  })

  it('keeps the stored seal when the report could not be sent', async () => {
    const held = sealed('held')
    const session = stubSession(stored(held))
    const submit = vi.fn<Transport['submit']>(async () => Promise.reject(new Error('offline')))
    await expect(client({ submit }, { continuity: 'session' }).identify()).rejects.toThrow('offline')
    expect(session.items.get(SEAL_STORAGE_KEY)).toBe(JSON.stringify(held))
  })

  it("removes the stored seal at once on setConsent('denied')", async () => {
    const session = stubSession()
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', next_seal: sealed('seal-1') }))
    const c = client({ submit }, { continuity: 'session' })
    await c.identify()
    expect(session.items.has(SEAL_STORAGE_KEY)).toBe(true)

    c.setConsent('denied')
    expect(session.items.has(SEAL_STORAGE_KEY)).toBe(false)

    c.setConsent('granted')
    await c.identify()
    expect(submit.mock.calls[1]![0]).not.toHaveProperty('seal')
  })

  it("leaves the stored seal on setConsent('pending') and does not read it", async () => {
    const session = stubSession()
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', next_seal: sealed('seal-1') }))
    const c = client({ submit }, { continuity: 'session' })
    await c.identify()
    session.calls.length = 0

    c.setConsent('pending')
    await expect(c.identify()).rejects.toBeInstanceOf(ConsentError)
    expect(session.calls).toEqual([])
    expect(session.items.has(SEAL_STORAGE_KEY)).toBe(true)

    c.setConsent('granted')
    await c.identify()
    expect(submit.mock.calls[1]![0].seal).toBe('seal-1')
  })

  it('reads nothing from storage while consent is not granted', async () => {
    for (const consent of ['pending', 'denied'] as const) {
      const session = stubSession(stored(sealed('held')))
      const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r' }))
      const c = client({ submit }, { continuity: 'session', consent })

      await expect(c.identify()).rejects.toBeInstanceOf(ConsentError)
      await expect(c.collect()).rejects.toBeInstanceOf(ConsentError)
      expect(submit).not.toHaveBeenCalled()
      expect(session.calls).toEqual([])
      vi.unstubAllGlobals()
    }
  })

  it('touches no storage when the client is built, or by collect()', async () => {
    const session = stubSession(stored(sealed('held')))
    const c = client({ submit: async () => ({ request_id: 'r' }) }, { continuity: 'session' })
    await c.collect()
    expect(session.calls).toEqual([])
  })

  it('stores nothing from an answer that arrives after consent was denied', async () => {
    const session = stubSession()
    let c!: FingerlyClient
    const submit = vi.fn<Transport['submit']>(async () => {
      c.setConsent('denied')
      return { request_id: 'r', next_seal: sealed('too-late') }
    })
    c = client({ submit }, { continuity: 'session' })
    await c.identify()
    expect(session.items.has(SEAL_STORAGE_KEY)).toBe(false)
    expect(session.calls.filter((call) => call.startsWith('set:'))).toEqual([])
  })

  it('never fails identify() on storage that throws, and logs nothing', async () => {
    const noise = [
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
    ]
    const refuse = (): never => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    const throwing = {
      getItem: refuse,
      setItem: refuse,
      removeItem: refuse,
      clear: refuse,
      key: refuse,
      get length(): number {
        return refuse()
      },
    }
    const submit = vi.fn<Transport['submit']>(async () => ({
      request_id: 'r',
      visitor_id: 'v1',
      next_seal: sealed('seal-1'),
    }))

    vi.stubGlobal('sessionStorage', throwing)
    const c = client({ submit }, { continuity: 'session' })
    await expect(c.identify()).resolves.toMatchObject({ requestId: 'r', visitorId: 'v1' })
    await expect(c.identify()).resolves.toMatchObject({ requestId: 'r' })
    expect(() => c.setConsent('denied')).not.toThrow()

    for (const [submission] of submit.mock.calls) {
      expect(submission.continuity).toBe('session')
      expect(submission).not.toHaveProperty('seal')
    }
    for (const spy of noise) expect(spy).not.toHaveBeenCalled()
  })

  it('never fails identify() where reading sessionStorage itself throws', async () => {
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', next_seal: sealed('seal-1') }))
    await withSessionStorageGetter(
      () => {
        throw new DOMException('Access is denied for this document.', 'SecurityError')
      },
      async () => {
        const c = client({ submit }, { continuity: 'session' })
        await expect(c.identify()).resolves.toMatchObject({ requestId: 'r' })
        await expect(c.identify()).resolves.toMatchObject({ requestId: 'r' })
        expect(() => c.setConsent('denied')).not.toThrow()
      },
    )
    for (const [submission] of submit.mock.calls) expect(submission).not.toHaveProperty('seal')
  })

  it('never fails identify() where there is no sessionStorage, as in a server render', async () => {
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', next_seal: sealed('seal-1') }))
    for (const missing of [undefined, null]) {
      await withSessionStorageGetter(
        () => missing,
        async () => {
          const c = client({ submit }, { continuity: 'session' })
          await expect(c.identify()).resolves.toMatchObject({ requestId: 'r' })
          await expect(c.identify()).resolves.toMatchObject({ requestId: 'r' })
          expect(() => c.setConsent('denied')).not.toThrow()
        },
      )
    }
    for (const [submission] of submit.mock.calls) {
      expect(submission.continuity).toBe('session')
      expect(submission).not.toHaveProperty('seal')
    }
  })

  it('goes on without a seal when only the write is refused', async () => {
    const session = stubSession(stored(sealed('held')))
    session.storage.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', next_seal: sealed('seal-2') }))
    const c = client({ submit }, { continuity: 'session' })
    await expect(c.identify()).resolves.toMatchObject({ requestId: 'r' })
    // The seal the server has already replaced is not left behind.
    expect(session.items.has(SEAL_STORAGE_KEY)).toBe(false)
    await expect(c.identify()).resolves.toMatchObject({ requestId: 'r' })
    expect(submit.mock.calls[1]![0]).not.toHaveProperty('seal')
  })

  it('never writes the seal to localStorage, cookies, IndexedDB, caches or window.name', async () => {
    const writes: string[] = []
    const session = stubSession()
    const local = recordingStorage()
    vi.stubGlobal('localStorage', local.storage)
    vi.stubGlobal('indexedDB', { open: (name: string) => writes.push(`idb:${name}`) })
    vi.stubGlobal('caches', { open: async (name: string) => writes.push(`cache:${name}`) })
    const doc = {}
    Object.defineProperty(doc, 'cookie', {
      get: () => '',
      set: (value: string) => writes.push(`cookie:${value}`),
    })
    vi.stubGlobal('document', doc)
    const page = globalThis as { name?: unknown }
    const windowName = page.name

    const answers: SubmitResponse[] = [
      { request_id: 'r1', next_seal: sealed('seal-1') },
      { request_id: 'r2', next_seal: sealed('seal-2') },
      { request_id: 'r3', next_seal: sealed('seal-3') },
    ]
    const submit = vi.fn<Transport['submit']>(async () => answers.shift()!)
    const c = client({ submit, ticket: async () => fresh('t') }, { continuity: 'session' })
    await c.identify()
    await c.identify()
    await c.identify()

    expect(session.items.has(SEAL_STORAGE_KEY)).toBe(true)
    expect(writes).toEqual([])
    expect(local.calls).toEqual([])
    expect(page.name).toBe(windowName)
    expect(String(page.name ?? '')).not.toContain('seal-')
    // sessionStorage saw one key and nothing else.
    const keys = new Set(session.calls.map((call) => call.slice(call.indexOf(':') + 1)))
    expect([...keys]).toEqual([SEAL_STORAGE_KEY])
    // Not on the client's printable surface either.
    expect(JSON.stringify(c)).not.toContain('seal-')

    c.setConsent('denied')
    expect(writes).toEqual([])
    expect(local.calls).toEqual([])
  })

  it('keeps the freshness ticket out of storage', async () => {
    const session = stubSession()
    const submit = vi.fn<Transport['submit']>(async () => ({
      request_id: 'r',
      next_ticket: fresh('next-ticket'),
      next_seal: sealed('seal-1'),
    }))
    const c = client({ submit, ticket: async () => fresh('asked-ticket') }, { continuity: 'session' })
    await c.identify()
    await c.identify()
    expect(submit.mock.calls.map((call) => call[0].ticket)).toEqual(['asked-ticket', 'next-ticket'])
    expect([...session.items.values()].join('')).not.toContain('ticket')
  })

  it('never puts seal or continuity on a ticket request', async () => {
    stubSession(stored(sealed('held')))
    const ticket = vi.fn<NonNullable<Transport['ticket']>>(async () => fresh('t'))
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', next_seal: sealed('seal-2') }))
    const c = client({ submit, ticket }, { continuity: 'session' })
    await c.identify()
    await c.identify()

    expect(ticket).toHaveBeenCalled()
    for (const [request] of ticket.mock.calls) {
      expect(request).toEqual({ v: 3, op: 'ticket', sdk: { platform: 'web', version: '0.4.0' } })
      expect(request).not.toHaveProperty('seal')
      expect(request).not.toHaveProperty('continuity')
    }
    expect(submit.mock.calls[0]![0].seal).toBe('held')
  })

  it('does nothing on a platform that is not the web', async () => {
    const session = stubSession(stored(sealed('held')))
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', next_seal: sealed('seal-1') }))
    const c = client({ submit }, { continuity: 'session', platform: 'android' })
    await c.identify()
    c.setConsent('denied')
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('continuity')
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('seal')
    expect(session.calls).toEqual([])
  })
})

describe('readSeal', () => {
  it('reads a seal and its expiry, and nothing beside them', () => {
    const expiresAt = expiresIn(60_000)
    expect(readSeal({ seal: 'abc_-9', expires_at: expiresAt, pow_bits: 4 })).toEqual({
      seal: 'abc_-9',
      expires_at: expiresAt,
    })
  })

  it('reads own properties only', () => {
    const expiresAt = expiresIn(60_000)
    expect(readSeal(Object.create({ seal: 'abc', expires_at: expiresAt }))).toBeUndefined()
    const prototype = Object.prototype as { seal?: unknown }
    prototype.seal = 'polluted'
    try {
      expect(readSeal({ expires_at: expiresAt })).toBeUndefined()
    } finally {
      delete prototype.seal
    }
  })

  it('refuses anything that is not a seal', () => {
    const expiresAt = expiresIn(60_000)
    for (const value of [
      undefined,
      null,
      'abc',
      7,
      {},
      { seal: 'abc' },
      { seal: 7, expires_at: expiresAt },
      { seal: '', expires_at: expiresAt },
      { seal: 'a b', expires_at: expiresAt },
      { seal: 'abc=', expires_at: expiresAt },
      { seal: 'a'.repeat(257), expires_at: expiresAt },
      { seal: 'abc', expires_at: 7 },
      { seal: 'abc', expires_at: 'soon' },
    ]) {
      expect(readSeal(value), JSON.stringify(value)).toBeUndefined()
    }
  })
})

describe('HttpTransport and the session seal', () => {
  it('puts continuity and seal in the report body and hands next_seal back', async () => {
    const session = stubSession(stored(sealed('held')))
    const next = sealed('seal-2')
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ request_id: 'r1', visitor_id: 'v1', next_seal: next }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const c = new FingerlyClient({
      apiKey: 'fly_pk_test',
      consent: 'granted',
      continuity: 'session',
      sources: [plain],
      transport: {
        submit: (submission, signal) =>
          new HttpTransport({
            apiKey: 'fly_pk_test',
            endpoints: '/k7x2qm4a',
            fetchImpl: fetchImpl as unknown as typeof fetch,
          }).submit(submission, signal),
      },
    })

    await expect(c.identify()).resolves.toMatchObject({ requestId: 'r1', visitorId: 'v1' })
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as Record<string, unknown>
    expect(body.continuity).toBe('session')
    expect(body.seal).toBe('held')
    expect(fetchImpl.mock.calls[0]![1]?.credentials).toBe('omit')
    expect(session.items.get(SEAL_STORAGE_KEY)).toBe(JSON.stringify(next))
  })
})
