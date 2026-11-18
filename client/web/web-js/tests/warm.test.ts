// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The answers a cold browser gives late (the voice list, the hardware-decode
// queries, the audio engine) are started as soon as collection is permitted, and never before.

function stubSlowApis() {
  const getVoices = vi.fn(() => [])
  const decodingInfo = vi.fn(async () => ({ supported: true, powerEfficient: true, smooth: true }))
  const startRendering = vi.fn(async () => ({}))
  const OfflineAudioContext = vi.fn(function (this: { startRendering: typeof startRendering }) {
    this.startRendering = startRendering
  })
  vi.stubGlobal('OfflineAudioContext', OfflineAudioContext)
  vi.stubGlobal('speechSynthesis', {
    getVoices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  Object.defineProperty(navigator, 'mediaCapabilities', {
    configurable: true,
    value: { decodingInfo },
  })
  return { getVoices, decodingInfo, startRendering }
}

async function freshSdk() {
  vi.resetModules()
  return import('../src/index.js')
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (navigator as { mediaCapabilities?: unknown }).mediaCapabilities
})

describe('warming the slow sources', () => {
  it('reads nothing while consent is pending', async () => {
    const { getVoices, decodingInfo, startRendering } = stubSlowApis()
    const { load } = await freshSdk()

    await load({ apiKey: 'fly_pk_development_test', consent: 'pending' })

    expect(getVoices).not.toHaveBeenCalled()
    expect(decodingInfo).not.toHaveBeenCalled()
    expect(startRendering).not.toHaveBeenCalled()
  })

  it('starts on load when consent is already granted', async () => {
    const { getVoices, decodingInfo, startRendering } = stubSlowApis()
    const { load } = await freshSdk()

    await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })

    expect(getVoices).toHaveBeenCalledTimes(1)
    expect(decodingInfo).toHaveBeenCalledTimes(3)
    expect(startRendering).toHaveBeenCalledTimes(1)
  })

  it('starts when consent is granted later, once', async () => {
    const { getVoices, decodingInfo } = stubSlowApis()
    const { load } = await freshSdk()

    const fingerly = await load({ apiKey: 'fly_pk_development_test', consent: 'pending' })
    fingerly.setConsent('denied')
    expect(getVoices).not.toHaveBeenCalled()

    fingerly.setConsent('granted')
    fingerly.setConsent('granted')
    expect(getVoices).toHaveBeenCalledTimes(1)
    expect(decodingInfo).toHaveBeenCalledTimes(3)
  })

  it('lets the codecs source reuse the early queries', async () => {
    const { decodingInfo } = stubSlowApis()
    const { load, browserSources } = await freshSdk()

    await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    const codecs = browserSources.find((source) => source.id === 'codecs')
    expect(codecs).toBeDefined()
    const value = (await codecs!.run({} as never)) as Record<string, unknown>

    expect(decodingInfo).toHaveBeenCalledTimes(3)
    expect(value.hw_av1).toBe(true)
  })

  it('does not warm a caller-supplied source set', async () => {
    const { getVoices, decodingInfo } = stubSlowApis()
    const { load } = await freshSdk()

    await load({ apiKey: 'fly_pk_development_test', consent: 'granted', sources: [] })

    expect(getVoices).not.toHaveBeenCalled()
    expect(decodingInfo).not.toHaveBeenCalled()
  })
})

describe('the early durability probe', () => {
  function stubIndexedDb() {
    const open = vi.fn(() => ({}) as IDBOpenDBRequest)
    vi.stubGlobal('indexedDB', { open, deleteDatabase: vi.fn() })
    vi.stubGlobal('chrome', {})
    return open
  }

  it('starts at load on a Chromium page that opted in and has consent', async () => {
    stubSlowApis()
    const open = stubIndexedDb()
    const { load } = await freshSdk()

    await load({ apiKey: 'fly_pk_development_test', consent: 'granted', incognitoDetection: 'extended' })

    expect(open).toHaveBeenCalledTimes(1)
  })

  it('waits for consent', async () => {
    stubSlowApis()
    const open = stubIndexedDb()
    const { load } = await freshSdk()

    const fingerly = await load({
      apiKey: 'fly_pk_development_test', consent: 'pending', incognitoDetection: 'extended',
    })
    expect(open).not.toHaveBeenCalled()
    fingerly.setConsent('granted')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('does not run for a page that did not opt in, or off Chromium', async () => {
    stubSlowApis()
    const open = stubIndexedDb()
    const { load } = await freshSdk()
    await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    expect(open).not.toHaveBeenCalled()

    vi.stubGlobal('chrome', undefined)
    const again = await freshSdk()
    await again.load({ apiKey: 'fly_pk_development_test', consent: 'granted', incognitoDetection: 'extended' })
    expect(open).not.toHaveBeenCalled()
  })
})
