import { afterEach, describe, expect, it, vi } from 'vitest'

import { FingerlyClient, resetEmbeddingWarning, type FingerlyClientOptions } from '../src/client.js'
import { ConsentError } from '../src/consent.js'
import type { Source } from '../src/source.js'
import type { SubmitResponse, Transport } from '../src/transport.js'

/**
 * A page inside an app runs no source (ADR 0024).
 *
 * The detector is the platform SDK's; what the kernel guarantees is that a
 * kind from it means nothing is read, nothing but the marker is sent, nothing
 * follows, and the detector itself is not asked before consent.
 */

const ANSWER: SubmitResponse = { request_id: 'request-1', visitor_id: 'visitor-1', deferred_token: 'continuation' }

function fakeTransport() {
  return {
    submit: vi.fn<Transport['submit']>(async () => ANSWER),
    submitSupplement: vi.fn<NonNullable<Transport['submitSupplement']>>(async () => undefined),
  }
}

function countingSource(id: string, tier: Source['tier']) {
  const calls = { count: 0 }
  const source: Source = {
    id,
    tier,
    run: () => {
      calls.count++
      return 1
    },
  }
  return { source, calls }
}

function client(options: Partial<FingerlyClientOptions>) {
  return new FingerlyClient({ apiKey: 'public', consent: 'granted', ...options })
}

afterEach(() => {
  vi.restoreAllMocks()
  resetEmbeddingWarning()
})

describe('an in-app web view', () => {
  it('runs no source and submits only the marker', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fast = countingSource('fast-one', 'fast')
    const late = countingSource('late-one', 'deferred')
    const integrity = vi.fn(() => ({ patched_natives: [], lies: [], engine: {} }))
    const transport = fakeTransport()
    const fingerly = client({ sources: [fast.source, late.source], transport, integrity, embedding: () => 'capacitor' })

    const result = await fingerly.identify()

    expect(fast.calls.count).toBe(0)
    expect(late.calls.count).toBe(0)
    expect(integrity).not.toHaveBeenCalled()
    expect(transport.submit).toHaveBeenCalledTimes(1)
    const submitted = transport.submit.mock.calls[0]![0]
    expect(submitted.consent).toBe('granted')
    expect(Object.keys(submitted.signals.sources)).toEqual(['embedding'])
    expect(submitted.signals.sources.embedding).toEqual({ status: 'ok', ms: 0, value: { kind: 'capacitor' } })
    expect(submitted.signals.integrity).toEqual({ patched_natives: [], lies: [], engine: {} })

    // A deferred token in the answer changes nothing: no supplement follows.
    await expect(result.deferred).resolves.toEqual({ status: 'skipped', reason: 'not-submitted' })
    expect(transport.submitSupplement).not.toHaveBeenCalled()
  })

  it('collects the same marker-only report', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fast = countingSource('fast-one', 'fast')
    const fingerly = client({ sources: [fast.source], transport: fakeTransport(), embedding: () => 'android-webview' })

    const report = await fingerly.collect()

    expect(fast.calls.count).toBe(0)
    expect(report.sources).toEqual({ embedding: { status: 'ok', ms: 0, value: { kind: 'android-webview' } } })
  })

  it('does not even look before consent', async () => {
    const embedding = vi.fn(() => 'capacitor')
    const transport = fakeTransport()
    const fingerly = client({ sources: [], transport, embedding, consent: 'pending' })

    await expect(fingerly.identify()).rejects.toBeInstanceOf(ConsentError)
    await expect(fingerly.collect()).rejects.toBeInstanceOf(ConsentError)
    expect(embedding).not.toHaveBeenCalled()
    expect(transport.submit).not.toHaveBeenCalled()
  })

  it('tells the integrator once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fingerly = client({ sources: [], transport: fakeTransport(), embedding: () => 'apple-webview' })

    await fingerly.identify()
    await fingerly.identify()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('apple-webview')
  })
})

describe('a browser', () => {
  it('is unchanged when the detector finds nothing', async () => {
    const warn = vi.spyOn(console, 'warn')
    const fast = countingSource('fast-one', 'fast')
    const transport = fakeTransport()
    const fingerly = client({ sources: [fast.source], transport, embedding: () => undefined })

    await fingerly.identify({ tiers: ['fast'] })

    expect(fast.calls.count).toBe(1)
    expect(Object.keys(transport.submit.mock.calls[0]![0].signals.sources)).toEqual(['fast-one'])
    expect(warn).not.toHaveBeenCalled()
  })
})
