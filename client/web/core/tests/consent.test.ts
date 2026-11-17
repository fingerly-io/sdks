import { describe, expect, it, vi } from 'vitest'

import { FingerlyClient, type FingerlyClientOptions } from '../src/client.js'
import { ConsentError } from '../src/consent.js'
import type { Source } from '../src/source.js'
import { TransportError, type SubmitResponse, type Transport } from '../src/transport.js'
import type { ConsentState } from '../src/types.js'

const ANSWER: SubmitResponse = { request_id: 'request-1', visitor_id: 'visitor-1', identifiable: true }

/** A transport that counts, and answers the way the server does. */
function fakeTransport(answer: SubmitResponse = ANSWER) {
  return {
    submit: vi.fn<Transport['submit']>(async () => answer),
  }
}

/** A source that records every run, so a test can say none happened. */
function countingSource(id = 'counted', stage: Source['stage'] = 'collect', run: Source['run'] = () => 1) {
  const calls = { count: 0 }
  const source: Source = {
    id,
    stage,
    run: (ctx) => {
      calls.count++
      return run(ctx)
    },
  }
  return { source, calls }
}

function client(options: Partial<FingerlyClientOptions> & Pick<FingerlyClientOptions, 'sources' | 'transport'>) {
  return new FingerlyClient({ apiKey: 'public', ...options })
}

describe('consent', () => {
  it('defaults to pending, collecting nothing and sending nothing', async () => {
    const { source, calls } = countingSource()
    const transport = fakeTransport()
    const fingerly = client({ sources: [source], transport })

    expect(fingerly.consent).toBe('pending')
    await expect(fingerly.identify()).rejects.toMatchObject({
      name: 'ConsentError',
      code: 'consent_required',
      state: 'pending',
    })
    await expect(fingerly.collect()).rejects.toBeInstanceOf(ConsentError)

    expect(calls.count).toBe(0)
    expect(transport.submit).not.toHaveBeenCalled()
  })

  it('identifies in one v: 3 pass when granted, and states consent in the submission body', async () => {
    const prereq = countingSource('engine', 'prerequisite')
    const main = countingSource('canvas', 'collect')
    const transport = fakeTransport()
    const fingerly = client({ sources: [prereq.source, main.source], transport, consent: 'granted' })

    const result = await fingerly.identify()
    expect(result.visitorId).toBe('visitor-1')

    expect(prereq.calls.count).toBe(1)
    expect(main.calls.count).toBe(1)
    expect(transport.submit).toHaveBeenCalledTimes(1)
    expect(transport.submit.mock.calls[0]![0]).toMatchObject({
      v: 3,
      consent: 'granted',
      sdk: { platform: 'web' },
    })
  })

  it('reports the server refusing consent as a ConsentError', async () => {
    const transport: Transport = {
      submit: async () => {
        throw new TransportError('The server refused the submission (422)', 422, false, 'consent_required')
      },
    }
    const fingerly = client({ sources: [countingSource().source], transport, consent: 'granted' })

    await expect(fingerly.identify()).rejects.toMatchObject({
      name: 'ConsentError',
      code: 'consent_required',
      state: 'pending',
    })
  })

  it.each<ConsentState>(['pending', 'denied'])(
    'refuses identify and collect while %s, running no source and sending nothing',
    async (state) => {
      const { source, calls } = countingSource()
      const transport = fakeTransport()
      const fingerly = client({ sources: [source], transport, consent: state })

      expect(fingerly.consent).toBe(state)

      const identified = fingerly.identify()
      await expect(identified).rejects.toBeInstanceOf(ConsentError)
      await expect(identified).rejects.toMatchObject({
        name: 'ConsentError',
        code: 'consent_required',
        state,
        message: `Fingerly needs consent before it can identify this visitor (consent is ${state})`,
      })
      await expect(fingerly.collect()).rejects.toBeInstanceOf(ConsentError)

      expect(calls.count).toBe(0)
      expect(transport.submit).not.toHaveBeenCalled()
    },
  )

  it('does nothing on construction, whatever the consent', () => {
    const { source, calls } = countingSource()
    const transport = fakeTransport()
    client({ sources: [source], transport, consent: 'granted' })
    client({ sources: [source], transport, consent: 'pending' })

    expect(calls.count).toBe(0)
    expect(transport.submit).not.toHaveBeenCalled()
  })

  it('identifies once consent is granted', async () => {
    const { source, calls } = countingSource()
    const transport = fakeTransport()
    const fingerly = client({ sources: [source], transport, consent: 'pending' })
    const listener = vi.fn()
    fingerly.onConsentChange(listener)

    await expect(fingerly.identify()).rejects.toBeInstanceOf(ConsentError)
    fingerly.setConsent('granted')

    expect(fingerly.consent).toBe('granted')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('granted')
    const result = await fingerly.identify()
    expect(result.requestId).toBe('request-1')
    expect(calls.count).toBe(1)
    expect(transport.submit).toHaveBeenCalledTimes(1)
  })

  it('notifies on a change only, and stops after unsubscribing', () => {
    const fingerly = client({ sources: [], transport: fakeTransport(), consent: 'granted' })
    const listener = vi.fn()
    const unsubscribe = fingerly.onConsentChange(listener)

    fingerly.setConsent('granted')
    expect(listener).not.toHaveBeenCalled()

    fingerly.setConsent('denied')
    fingerly.setConsent('denied')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('denied')

    unsubscribe()
    fingerly.setConsent('granted')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('rejects a value that is not a consent state', () => {
    const transport = fakeTransport()
    expect(() => client({ sources: [], transport, consent: 'yes' as ConsentState })).toThrow(TypeError)
    const fingerly = client({ sources: [], transport })
    expect(() => fingerly.setConsent(true as unknown as ConsentState)).toThrow(TypeError)
    expect(fingerly.consent).toBe('pending')
  })

  it('does not submit when consent is withdrawn inside a source, and starts no further source', async () => {
    const transport = fakeTransport()
    let fingerly!: FingerlyClient
    const first = countingSource('first', 'prerequisite', () => {
      fingerly.setConsent('denied')
      return 1
    })
    const second = countingSource('second', 'collect')
    fingerly = client({
      sources: [first.source, second.source],
      transport,
      schedule: { concurrency: 1 },
      consent: 'granted',
    })

    await expect(fingerly.identify()).rejects.toMatchObject({ code: 'consent_required', state: 'denied' })

    expect(first.calls.count).toBe(1)
    expect(second.calls.count).toBe(0)
    expect(transport.submit).not.toHaveBeenCalled()
  })

  it('discards a collect() report when consent is withdrawn while it runs', async () => {
    let fingerly!: FingerlyClient
    const { source } = countingSource('first', 'collect', () => {
      fingerly.setConsent('pending')
      return 1
    })
    fingerly = client({ sources: [source], transport: fakeTransport(), consent: 'granted' })

    await expect(fingerly.collect()).rejects.toBeInstanceOf(ConsentError)
  })

  it('abandons a submission in flight when consent is withdrawn', async () => {
    let started!: () => void
    const inFlight = new Promise<void>((resolve) => {
      started = resolve
    })
    const transport: Transport = {
      submit: (_submission, signal) =>
        new Promise<SubmitResponse>((_resolve, reject) => {
          started()
          signal?.addEventListener('abort', () => reject(new Error('The submission was cancelled')))
        }),
    }
    const fingerly = client({ sources: [countingSource().source], transport, consent: 'granted' })

    const identified = fingerly.identify()
    await inFlight
    fingerly.setConsent('denied')

    await expect(identified).rejects.toBeInstanceOf(ConsentError)
  })

  it('keeps notifying the others when one listener throws', () => {
    vi.useFakeTimers()
    try {
      const fingerly = client({ sources: [], transport: fakeTransport(), consent: 'granted' })
      const after = vi.fn()
      fingerly.onConsentChange(() => {
        throw new Error('listener exploded')
      })
      fingerly.onConsentChange(after)

      expect(() => fingerly.setConsent('denied')).not.toThrow()
      expect(after).toHaveBeenCalledWith('denied')
      expect(() => vi.runAllTimers()).toThrow('listener exploded')
    } finally {
      vi.useRealTimers()
    }
  })
})
