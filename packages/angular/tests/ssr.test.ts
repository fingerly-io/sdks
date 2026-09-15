/**
 * @vitest-environment node
 *
 * Server-side rendering.
 *
 * Deliberately in the `node` environment with no DOM at all, because that is
 * what an Angular SSR render actually is. A test that ran this under happy-dom
 * would have a `window` and would prove nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@fingerly/web-js', () => ({
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
}))

const { createFingerly, FingerlyServerError } = await import('../src/state.js')

beforeEach(() => {
  vi.clearAllMocks()
  identifyMock.mockResolvedValue({ requestId: 'req_1', verdicts: {}, report: {} })
  loadMock.mockResolvedValue({ identify: identifyMock })
})

describe('under SSR', () => {
  it('has no window, so the premise of these tests holds', () => {
    expect(typeof window).toBe('undefined')
  })

  it('builds the state without touching the browser', () => {
    const fingerly = createFingerly({ apiKey: 'pk_test' })

    // The application injector builds this during a server render, so it has
    // to be inert there: the page renders its "not yet identified" state and
    // the browser picks it up on hydration.
    expect(fingerly.isReady()).toBe(false)
    expect(fingerly.isSuspicious()).toBe(false)
    expect(loadMock).not.toHaveBeenCalled()
  })

  it('rejects a direct identify() with a message that says what to do', async () => {
    const fingerly = createFingerly({ apiKey: 'pk_test' })

    await expect(fingerly.identify()).rejects.toBeInstanceOf(FingerlyServerError)
    await expect(fingerly.identify()).rejects.toThrow(/cannot run during server-side rendering/)
    await expect(fingerly.identify()).rejects.toThrow(/immediate: true/)
    expect(identifyMock).not.toHaveBeenCalled()
  })
})
