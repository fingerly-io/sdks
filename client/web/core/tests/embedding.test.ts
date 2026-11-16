import { afterEach, describe, expect, it, vi } from 'vitest'

import { FingerlyClient, resetEmbeddingWarning, type FingerlyClientOptions } from '../src/client.js'
import { ConsentError } from '../src/consent.js'
import { SOURCE } from '../src/signals.js'
import type { Source } from '../src/source.js'
import type { SubmitResponse, Transport } from '../src/transport.js'

/**
 * DPLA-safe embedded WebView subset (`F-01`):
 * When `embedding()` detects an in-app WebView, non-identifying runtime and
 * integrity sources (`engine`, `timing`, `permissions`, `automation`, `math`,
 * `errors`, `navigator`, `worker_realm`, `embedding`, and `lies`) still execute
 * to catch spoofed headless WebViews, while all device-fingerprinting collectors
 * are skipped so genuine mobile WebViews remain Apple DPLA §3.3.3(B)-compliant.
 */

const ANSWER: SubmitResponse = {
  request_id: 'request-1',
  visitor_id: '',
  identifiable: false,
  state: 'enriched',
}

function fakeTransport() {
  return {
    submit: vi.fn<Transport['submit']>(async () => ANSWER),
  }
}

function countingSource(
  id: string,
  stage: Source['stage'] = 'collect',
  overrides: Partial<Source> = {},
) {
  const calls = { count: 0 }
  const source: Source = {
    id,
    stage,
    ...overrides,
    run: () => {
      calls.count++
      return { id }
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

describe('an in-app web view (F-01 DPLA-safe subset)', () => {
  it('runs non-identifying runtime + lies integrity sources while skipping device-fingerprinting sources', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const safeIds = [
      SOURCE.engine,
      SOURCE.timing,
      SOURCE.permissions,
      SOURCE.automation,
      SOURCE.math,
      SOURCE.errors,
      SOURCE.navigator,
      SOURCE.workerRealm,
    ]
    const skippedIds = [
      SOURCE.canvas,
      SOURCE.audio,
      SOURCE.fonts,
      SOURCE.webgl,
      SOURCE.screen,
      SOURCE.hardware,
      SOURCE.shields,
      SOURCE.storage,
      SOURCE.storageDurability,
      SOURCE.mediaDevices,
      SOURCE.colorGamut,
      SOURCE.touch,
      SOURCE.intl,
      SOURCE.languages,
      SOURCE.userAgentData,
    ]

    const safeEntries = safeIds.map((id) =>
      countingSource(id, id === SOURCE.engine || id === SOURCE.timing ? 'prerequisite' : 'collect'),
    )
    const skippedEntries = skippedIds.map((id) =>
      countingSource(
        id,
        'collect',
        id === SOURCE.storageDurability ? { optIn: 'extended-incognito' } : {},
      ),
    )

    const integrity = vi.fn(({ sources }: { sources: Record<string, unknown> }) => ({
      patched_natives: ['Navigator.prototype.userAgent'],
      lies: [{ id: 'Navigator.prototype.userAgent', kind: 'descriptor' as const }],
      engine: { ...(sources.engine ? { observed: 'v8' } : {}), claimed: 'webkit' },
    }))
    const transport = fakeTransport()

    const fingerly = client({
      sources: [...safeEntries.map((e) => e.source), ...skippedEntries.map((e) => e.source)],
      transport,
      integrity,
      embedding: () => 'apple-webview',
    })

    const result = await fingerly.identify({ incognitoDetection: 'extended' })

    for (const entry of safeEntries) {
      expect(entry.calls.count, `expected ${entry.source.id} to run`).toBe(1)
    }
    for (const entry of skippedEntries) {
      expect(entry.calls.count, `expected ${entry.source.id} to be skipped`).toBe(0)
    }

    expect(integrity).toHaveBeenCalledTimes(1)
    expect(transport.submit).toHaveBeenCalledTimes(1)

    const submitted = transport.submit.mock.calls[0]![0]
    expect(submitted.v).toBe(3)
    expect(submitted.consent).toBe('granted')
    expect(Object.keys(submitted.signals.sources).sort()).toEqual(
      [...safeIds, SOURCE.embedding].sort(),
    )
    expect(submitted.signals.sources.embedding).toEqual({
      status: 'ok',
      ms: 0,
      value: { kind: 'apple-webview' },
    })
    expect(submitted.signals.integrity).toEqual({
      patched_natives: ['Navigator.prototype.userAgent'],
      lies: [{ id: 'Navigator.prototype.userAgent', kind: 'descriptor' }],
      engine: { observed: 'v8', claimed: 'webkit' },
    })
    expect(result.visitorId).toBe('')
    expect(result.visitorIsNew).toBe(false)
  })

  it('collects the same DPLA-safe report locally via collect()', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const engine = countingSource(SOURCE.engine, 'prerequisite')
    const canvas = countingSource(SOURCE.canvas, 'collect')
    const integrity = vi.fn(() => ({ patched_natives: [], lies: [], engine: { observed: 'v8' } }))

    const fingerly = client({
      sources: [engine.source, canvas.source],
      integrity,
      transport: fakeTransport(),
      embedding: () => 'android-webview',
    })

    const report = await fingerly.collect()

    expect(engine.calls.count).toBe(1)
    expect(canvas.calls.count).toBe(0)
    expect(integrity).toHaveBeenCalledTimes(1)
    expect(Object.keys(report.sources).sort()).toEqual(['embedding', 'engine'])
    expect(report.sources.embedding).toEqual({
      status: 'ok',
      ms: 0,
      value: { kind: 'android-webview' },
    })
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
  it('runs all standard sources when the detector finds nothing', async () => {
    const warn = vi.spyOn(console, 'warn')
    const canvas = countingSource(SOURCE.canvas, 'collect')
    const transport = fakeTransport()
    const fingerly = client({ sources: [canvas.source], transport, embedding: () => undefined })

    await fingerly.identify()

    expect(canvas.calls.count).toBe(1)
    expect(Object.keys(transport.submit.mock.calls[0]![0].signals.sources)).toEqual([SOURCE.canvas])
    expect(warn).not.toHaveBeenCalled()
  })
})
