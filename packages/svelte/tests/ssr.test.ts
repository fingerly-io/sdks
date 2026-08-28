/**
 * @vitest-environment node
 *
 * Server-side rendering.
 *
 * Deliberately in the `node` environment with no DOM at all, because that is
 * what a SvelteKit server render actually is. A test that ran this under
 * happy-dom would have a `window` and would prove nothing.
 */

import { render } from 'svelte/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@badele/web-js', () => ({
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
}))

const Server = (await import('./fixtures/Server.svelte')).default

const globals = globalThis as Record<string, unknown>
const { BadeleServerError } = await import('../src/state.svelte.js')

beforeEach(() => {
  vi.clearAllMocks()
  identifyMock.mockResolvedValue({ requestId: 'req_1', verdicts: {}, report: {} })
  loadMock.mockResolvedValue({ identify: identifyMock })
  delete globals.__badeleServerError
})

describe('under SSR', () => {
  it('has no window, so the premise of these tests holds', () => {
    expect(typeof window).toBe('undefined')
  })

  it('renders a page that uses immediate, without collecting anything', () => {
    const { body } = render(Server)

    // `immediate` runs in an $effect, which a server render never reaches. The
    // page renders its "not yet identified" state and the client picks it up
    // on hydration.
    expect(body).toContain('ready:false')
    expect(body).toContain('suspicious:false')
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('rejects a direct identify() with a message that says what to do', async () => {
    // The result is read, not discarded: `render()` is lazy in Svelte 5 and a
    // return value nobody touches never renders anything.
    expect(render(Server).body).toContain('ready:false')

    await new Promise((resolve) => setTimeout(resolve, 0))

    const captured = globals.__badeleServerError
    expect(captured).toBeInstanceOf(BadeleServerError)
    expect((captured as Error).message).toMatch(/cannot run during server-side rendering/)
    expect((captured as Error).message).toMatch(/immediate: true/)
  })
})
