// @vitest-environment happy-dom
//
// WEB-09: a polluted Object.prototype present when the module loads does not
// let a device-fingerprinting source run inside an app.

import { afterEach, describe, expect, it, vi } from 'vitest'

const ctx = () =>
  ({ signal: new AbortController().signal, budgetRemainingMs: () => 350, completed: () => undefined, shared: new Map() }) as never

describe('guarded() under a polluted prototype (WEB-09)', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).embeddedSafe
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('keeps refusing the hardware source in embedded mode', async () => {
    vi.stubGlobal('ReactNativeWebView', {})
    ;(Object.prototype as Record<string, unknown>).embeddedSafe = true
    vi.resetModules()
    const fresh = await import('../src/sources/index.js')
    const hardware = fresh.browserSources.find((s) => s.id === 'hardware')!
    const outcome = await Promise.resolve()
      .then(() => hardware.run(ctx()))
      .then(
        () => 'ran',
        (e: { reason?: string }) => 'refused:' + e.reason,
      )
    expect(outcome).toBe('refused:embedded')
  })
})
