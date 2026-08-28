/**
 * @vitest-environment node
 *
 * Server-side rendering.
 *
 * Deliberately in the `node` environment with no DOM at all, because that is
 * what a Next.js server render actually is. A test that ran this under
 * happy-dom would have a `window` and would prove nothing.
 */

import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@badele/web-js', () => ({
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
}))

const { BadeleProvider } = await import('../src/context.js')
const { BadeleServerError } = await import('../src/store.js')
const { useIdentify } = await import('../src/useIdentify.js')

beforeEach(() => {
  vi.clearAllMocks()
  identifyMock.mockResolvedValue({ requestId: 'req_1', verdicts: {}, report: {} })
  loadMock.mockResolvedValue({ identify: identifyMock })
})

describe('under SSR', () => {
  it('has no window, so the premise of these tests holds', () => {
    expect(typeof window).toBe('undefined')
  })

  it('renders a page that uses immediate, without collecting anything', () => {
    const Page = () => {
      const { isReady, isSuspicious } = useIdentify({ immediate: true })
      return <div>{`ready:${isReady} suspicious:${isSuspicious}`}</div>
    }

    const html = renderToString(
      <BadeleProvider apiKey="pk_test">
        <Page />
      </BadeleProvider>,
    )

    // `immediate` runs in an effect, which a server render never reaches. The
    // page renders its "not yet identified" state and the client picks it up
    // on hydration.
    expect(html).toBe('<div>ready:false suspicious:false</div>')
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('renders a page that asks to suspend, without suspending', () => {
    // There is nothing to collect from on a server, so suspending there would
    // hang the render waiting for an answer that cannot arrive. It renders the
    // unidentified state and suspends after hydration instead.
    const Page = () => {
      const { isReady } = useIdentify({ suspend: true })
      return <div>{`ready:${isReady}`}</div>
    }

    const html = renderToString(
      <BadeleProvider apiKey="pk_test">
        <Page />
      </BadeleProvider>,
    )

    expect(html).toBe('<div>ready:false</div>')
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('rejects a direct identify() with a message that says what to do', async () => {
    let captured: unknown

    const Page = () => {
      const { identify } = useIdentify()
      // Awaiting is not possible in a render, so the rejection is captured
      // rather than awaited; what matters is which error it is.
      identify().catch((error: unknown) => {
        captured = error
      })
      return <div />
    }

    renderToString(
      <BadeleProvider apiKey="pk_test">
        <Page />
      </BadeleProvider>,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(captured).toBeInstanceOf(BadeleServerError)
    expect((captured as Error).message).toMatch(/cannot run during server-side rendering/)
    expect((captured as Error).message).toMatch(/immediate: true/)
  })
})
