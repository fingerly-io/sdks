// @vitest-environment happy-dom
//
// WEB-14: fields no server rule reads are not collected.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SOURCE } from '@fingerly/core'

import { automationSource, browserSources, mathSource, userAgentDataSource } from '../src/sources/index.js'

const ctx = {} as never

describe('collected fields (WEB-14)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('math sends no digest', async () => {
    const value = (await mathSource.run(ctx)) as Record<string, unknown>
    expect(value).not.toHaveProperty('hash')
    expect(value).toMatchObject({ atanh_half: expect.any(Number), expm1_1: expect.any(Number), identities_hold: true })
  })

  it('automation sends no chrome_object', async () => {
    const value = (await automationSource.run(ctx)) as Record<string, unknown>
    expect(value).not.toHaveProperty('chrome_object')
  })

  it('has no plugins source', () => {
    expect(browserSources.map((source) => source.id)).not.toContain('plugins')
    expect(Object.values(SOURCE)).not.toContain('plugins')
  })

  it('asks only for the architecture client hint', async () => {
    const getHighEntropyValues = vi.fn(async () => ({
      architecture: 'arm',
      bitness: '64',
      model: '',
      platformVersion: '15.0.0',
      brands: [{ brand: 'Chromium', version: '131' }],
      mobile: false,
      platform: 'macOS',
    }))
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgentData: { brands: [{ brand: 'Chromium', version: '131' }], mobile: false, platform: 'macOS', getHighEntropyValues },
    })
    const value = await userAgentDataSource.run(ctx)
    expect(getHighEntropyValues).toHaveBeenCalledWith(['architecture'])
    expect(value).toEqual({
      brands: [{ brand: 'Chromium', version: '131' }],
      mobile: false,
      platform: 'macOS',
      architecture: 'arm',
    })
  })
})
