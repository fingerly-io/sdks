import { afterEach, describe, expect, it, vi } from 'vitest'

import { engineSource } from '../src/sources/engine.js'
import type { EngineSignal } from '@fingerly/core'

const claimFor = (userAgent: string): string | undefined => {
  vi.stubGlobal('navigator', { userAgent })
  return (engineSource.run({} as never) as EngineSignal).claimed
}

describe('the engine a user agent claims', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads Firefox for iOS as WebKit, which is what it runs on', () => {
    expect(
      claimFor(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15',
      ),
    ).toBe('webkit')
  })

  it('still reads desktop Firefox as Gecko', () => {
    expect(claimFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe('gecko')
  })
})
