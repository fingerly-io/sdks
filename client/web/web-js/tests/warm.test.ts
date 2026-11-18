// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The answers a cold browser gives late (the voice list, the hardware-decode
// queries) are started as soon as collection is permitted, and never before.

function stubSlowApis() {
  const getVoices = vi.fn(() => [])
  const decodingInfo = vi.fn(async () => ({ supported: true, powerEfficient: true, smooth: true }))
  vi.stubGlobal('speechSynthesis', {
    getVoices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  Object.defineProperty(navigator, 'mediaCapabilities', {
    configurable: true,
    value: { decodingInfo },
  })
  return { getVoices, decodingInfo }
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
    const { getVoices, decodingInfo } = stubSlowApis()
    const { load } = await freshSdk()

    await load({ apiKey: 'fly_pk_development_test', consent: 'pending' })

    expect(getVoices).not.toHaveBeenCalled()
    expect(decodingInfo).not.toHaveBeenCalled()
  })

  it('starts on load when consent is already granted', async () => {
    const { getVoices, decodingInfo } = stubSlowApis()
    const { load } = await freshSdk()

    await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })

    expect(getVoices).toHaveBeenCalledTimes(1)
    expect(decodingInfo).toHaveBeenCalledTimes(3)
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
