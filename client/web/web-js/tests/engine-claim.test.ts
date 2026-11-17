import { afterEach, describe, expect, it, vi } from 'vitest'

import { engineSource } from '../src/sources/engine.js'
import type { EngineSignal } from '@fingerly/core'

const runEngine = (userAgent: string): EngineSignal => {
  vi.stubGlobal('navigator', { userAgent })
  return engineSource.run({} as never) as EngineSignal
}

describe('engineSource claims & structural capability flags', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads Firefox for iOS as WebKit, which is what it runs on', () => {
    expect(
      runEngine(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15',
      ).claimed,
    ).toBe('webkit')
  })

  it('still reads desktop Firefox as Gecko', () => {
    expect(
      runEngine(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
      ).claimed,
    ).toBe('gecko')
  })

  it('detects DeviceMotionEvent.requestPermission structurally without ever invoking it', () => {
    const requestPermission = vi.fn(() => {
      throw new Error('must never be invoked')
    })
    vi.stubGlobal('DeviceMotionEvent', { requestPermission })

    const signal = runEngine('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')
    expect(signal.has_motion_permission_fn).toBe(true)
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('reports CSS @supports engine-exclusive flags (moz_appearance and webkit_touch_callout)', () => {
    vi.stubGlobal('CSS', {
      supports: (prop: string, val: string) => prop === '-moz-appearance' && val === 'none',
    })
    const signal = runEngine('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0')
    expect(signal.moz_appearance).toBe(true)
    expect(signal.webkit_touch_callout).toBe(false)
  })
})
