import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FingerlyClient } from '../src/client.js'
import { MAX_POW_BITS, POW_BUDGET_MS, powSearch, powWorkerSource, solvePow } from '../src/pow.js'
import { SOURCE } from '../src/signals.js'
import type { Source } from '../src/source.js'
import type { SubmitResponse, Transport } from '../src/transport.js'

/** R12 shared vector: ticket `abc`, 8 bits. The server suite asserts the same nonce. */
const VECTOR = { ticket: 'abc', bits: 8, nonce: '181' }

function leadingZeroBits(ticket: string, nonce: string): number {
  const digest = createHash('sha256').update(`${ticket}:${nonce}`, 'utf8').digest()
  let bits = 0
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8
      continue
    }
    bits += Math.clz32(byte) - 24
    break
  }
  return bits
}

function reference(ticket: string, bits: number): number {
  for (let n = 0; ; n++) if (leadingZeroBits(ticket, String(n)) >= bits) return n
}

const plain: Source = { id: SOURCE.canvas, stage: 'collect', run: () => ({ ok: true }) }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('proof of work solver (R12)', () => {
  it('finds the shared vector nonce', () => {
    expect(powSearch(VECTOR.ticket, VECTOR.bits, 0, 10_000)).toBe(Number(VECTOR.nonce))
    expect(leadingZeroBits(VECTOR.ticket, VECTOR.nonce)).toBeGreaterThanOrEqual(8)
    for (let n = 0; n < Number(VECTOR.nonce); n++) {
      expect(leadingZeroBits(VECTOR.ticket, String(n))).toBeLessThan(8)
    }
  })

  it('agrees with a reference SHA-256 for every ticket length class', () => {
    // Lengths around the 55/64/119/128-byte padding edges, so one- and
    // two-block tails and the precomputed whole blocks are all exercised.
    for (const length of [1, 20, 50, 54, 55, 56, 62, 63, 64, 65, 110, 118, 119, 127, 128, 200, 400]) {
      const ticket = 'Ab0_-'.repeat(100).slice(0, length)
      for (const bits of [1, 4, 8, 10]) {
        expect(powSearch(ticket, bits, 0, 1 << 20), `${length}/${bits}`).toBe(reference(ticket, bits))
      }
    }
  })

  it('returns -1 when the range holds no answer', () => {
    expect(powSearch(VECTOR.ticket, VECTOR.bits, 0, 181)).toBe(-1)
    expect(powSearch(VECTOR.ticket, VECTOR.bits, 181, 182)).toBe(181)
  })

  it('solves in time slices without a Worker', async () => {
    await expect(solvePow(VECTOR.ticket, VECTOR.bits, { worker: false })).resolves.toBe(VECTOR.nonce)
  })

  it('gives up at the budget and answers undefined', async () => {
    expect(POW_BUDGET_MS).toBe(1500)
    await expect(solvePow('budget', MAX_POW_BITS, { budgetMs: 0, worker: false })).resolves.toBeUndefined()

    const started = performance.now()
    const answer = await solvePow('budget-ticket-that-takes-long', MAX_POW_BITS, { budgetMs: 60, worker: false })
    expect(performance.now() - started).toBeLessThan(60 + 200)
    if (answer !== undefined) expect(leadingZeroBits('budget-ticket-that-takes-long', answer)).toBeGreaterThanOrEqual(22)
  })

  it('yields to the event loop between slices', async () => {
    let ticks = 0
    const interval = setInterval(() => ticks++, 1)
    await solvePow('yield-check', MAX_POW_BITS, { budgetMs: 80, worker: false })
    clearInterval(interval)
    expect(ticks).toBeGreaterThan(1)
  })

  it('refuses a work factor it does not solve', async () => {
    for (const bits of [0, -1, 1.5, MAX_POW_BITS + 1, Number.NaN]) {
      await expect(solvePow('abc', bits, { worker: false })).resolves.toBeUndefined()
    }
  })

  it('solves in a Worker built from its own source', async () => {
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null
      onerror: ((event: unknown) => void) | null = null
      terminated = false
      private readonly self: { onmessage?: (event: { data: unknown }) => void; postMessage(v: unknown): void }
      constructor(_url: string) {
        this.self = { postMessage: (value) => setTimeout(() => this.onmessage?.({ data: value }), 0) }
        new Function('self', powWorkerSource())(this.self)
        workers.push(this)
      }
      postMessage(message: unknown) {
        setTimeout(() => this.self.onmessage?.({ data: message }), 0)
      }
      terminate() {
        this.terminated = true
      }
    }
    const workers: FakeWorker[] = []
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: () => undefined })

    await expect(solvePow(VECTOR.ticket, VECTOR.bits)).resolves.toBe(VECTOR.nonce)
    expect(workers).toHaveLength(1)
    expect(workers[0]!.terminated).toBe(true)
  })

  it('falls back to time slices when a Worker is refused', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('refused by policy')
        }
      },
    )
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: () => undefined })
    await expect(solvePow(VECTOR.ticket, VECTOR.bits)).resolves.toBe(VECTOR.nonce)
  })

  it('stops a Worker that has not answered by the budget', async () => {
    let terminated = false
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null
        onerror = null
        postMessage() {}
        terminate() {
          terminated = true
        }
      },
    )
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: () => undefined })
    await expect(solvePow(VECTOR.ticket, VECTOR.bits, { budgetMs: 20 })).resolves.toBeUndefined()
    expect(terminated).toBe(true)
  })
})

describe('ticket_pow on the report', () => {
  function client(transport: Transport): FingerlyClient {
    return new FingerlyClient({ apiKey: 'fly_pk_test', consent: 'granted', sources: [plain], transport })
  }

  it('sends the solved nonce next to the ticket', async () => {
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r' }))
    const ticket = async () => ({
      ticket: VECTOR.ticket,
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      pow_bits: VECTOR.bits,
    })
    await client({ submit, ticket }).identify()
    expect(submit.mock.calls[0]![0]).toMatchObject({ ticket: 'abc', ticket_pow: VECTOR.nonce })
  })

  it('solves a held next_ticket before the next report', async () => {
    const answers: SubmitResponse[] = [
      {
        request_id: 'r1',
        next_ticket: {
          ticket: 'nextticket',
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          pow_bits: 10,
        },
      },
      { request_id: 'r2' },
    ]
    const submit = vi.fn<Transport['submit']>(async () => answers.shift()!)
    const c = client({ submit, ticket: async () => ({ ticket: 'first', expires_at: new Date(Date.now() + 300_000).toISOString() }) })
    await c.identify()
    await c.identify()
    const first = submit.mock.calls[0]![0]
    const second = submit.mock.calls[1]![0]
    expect(first.ticket).toBe('first')
    expect(first).not.toHaveProperty('ticket_pow')
    expect(second.ticket).toBe('nextticket')
    expect(second.ticket_pow).toBe(String(reference('nextticket', 10)))
  })

  it('sends no ticket_pow when the ticket does not ask for one', async () => {
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r' }))
    for (const pow_bits of [undefined, 0, 23, 'eight']) {
      const ticket = async () =>
        ({
          ticket: 'abc',
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          ...(pow_bits === undefined ? {} : { pow_bits }),
        }) as never
      await client({ submit, ticket }).identify()
    }
    for (const call of submit.mock.calls) {
      expect(call[0].ticket).toBe('abc')
      expect(call[0]).not.toHaveProperty('ticket_pow')
    }
  })
})
