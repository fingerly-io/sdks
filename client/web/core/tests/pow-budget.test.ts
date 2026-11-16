import { describe, expect, it, vi } from 'vitest'

// The solver is replaced here so the client's handling of a timed-out
// solution can be checked without spending the real 1500 ms budget.
const solvePow = vi.hoisted(() => vi.fn<(ticket: string, bits: number) => Promise<string | undefined>>())
vi.mock('../src/pow.js', async (actual) => ({
  ...(await actual<typeof import('../src/pow.js')>()),
  solvePow,
}))

import { FingerlyClient } from '../src/client.js'
import { SOURCE } from '../src/signals.js'
import type { Source } from '../src/source.js'
import type { Transport } from '../src/transport.js'

const plain: Source = { id: SOURCE.canvas, stage: 'collect', run: () => ({ ok: true }) }

function powTicket() {
  return { ticket: 'abc', expires_at: new Date(Date.now() + 300_000).toISOString(), pow_bits: 20 }
}

describe('ticket_pow budget fallback (R12)', () => {
  it('sends the ticket without ticket_pow when the budget runs out', async () => {
    solvePow.mockReset()
    solvePow.mockResolvedValue(undefined)
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r', visitor_id: 'v' }))
    const c = new FingerlyClient({
      apiKey: 'k',
      consent: 'granted',
      sources: [plain],
      transport: { submit, ticket: async () => powTicket() },
    })
    await expect(c.identify()).resolves.toMatchObject({ visitorId: 'v' })
    expect(submit.mock.calls[0]![0].ticket).toBe('abc')
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('ticket_pow')
  })

  it('never fails identify when the solver throws', async () => {
    solvePow.mockReset()
    solvePow.mockRejectedValue(new Error('boom'))
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r' }))
    const c = new FingerlyClient({
      apiKey: 'k',
      consent: 'granted',
      sources: [plain],
      transport: { submit, ticket: async () => powTicket() },
    })
    await expect(c.identify()).resolves.toMatchObject({ requestId: 'r' })
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('ticket_pow')
  })

  it('starts solving the moment the ticket arrives, during collection', async () => {
    solvePow.mockReset()
    let collectionDone = false
    const seenDuringCollection: boolean[] = []
    solvePow.mockImplementation(async () => {
      seenDuringCollection.push(!collectionDone)
      return '7'
    })
    const slow: Source = {
      id: SOURCE.canvas,
      stage: 'collect',
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        collectionDone = true
        return { ok: true }
      },
    }
    const submit = vi.fn<Transport['submit']>(async () => ({ request_id: 'r' }))
    const c = new FingerlyClient({
      apiKey: 'k',
      consent: 'granted',
      sources: [slow],
      transport: { submit, ticket: async () => powTicket() },
    })
    await c.identify()
    expect(seenDuringCollection).toEqual([true])
    expect(submit.mock.calls[0]![0].ticket_pow).toBe('7')
  })
})
