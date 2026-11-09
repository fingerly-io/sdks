/**
 * @vitest-environment node
 *
 * The server render.
 *
 * A Next page is rendered on the server first, with no DOM at all, and the
 * provider sits in `app/layout.tsx` - so the render nobody thinks about is the
 * one that must not collect anything or throw.
 */

import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@fingerly/web-js', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
}))

const { FingerlyProvider } = await import('../src/provider.js')
const { FingerlyRequestId } = await import('../src/field.js')

beforeEach(() => {
  vi.clearAllMocks()
  identifyMock.mockResolvedValue({ requestId: 'req_1', report: {} })
  loadMock.mockResolvedValue({ identify: identifyMock })
  ;(process.env as Record<string, string | undefined>).NEXT_PUBLIC_FINGERLY_API_KEY = 'pk_from_env'
})

describe('under SSR', () => {
  it('has no window, so the premise of these tests holds', () => {
    expect(typeof window).toBe('undefined')
  })

  it('renders the provider and the field without collecting anything', () => {
    const html = renderToString(
      <FingerlyProvider>
        <form>
          <FingerlyRequestId />
        </form>
      </FingerlyProvider>,
    )

    // The field is in the server-rendered HTML and empty. That is the
    // difference between a form that submits early and one that never had a
    // field: the server can tell them apart.
    expect(html).toContain(`name="fingerly_request_id"`)
    expect(html).toContain('type="hidden"')
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('reads the environment on the server as well as in the browser', () => {
    // The same variable, read the same way, in both renders - a provider that
    // found a key on the server and none after hydration would identify only
    // for visitors who never reloaded.
    const environment = process.env as Record<string, string | undefined>
    delete environment.NEXT_PUBLIC_FINGERLY_API_KEY
    environment.NEXT_PUBLIC_FINGERLY_API_KEY = 'pk_server_env'

    // Rendered, with the key from the environment: a missing one is reported,
    // never thrown, so the server render cannot fail over it either.
    const html = renderToString(
      <FingerlyProvider>
        <span>page</span>
      </FingerlyProvider>,
    )
    expect(html).toContain('page')
    delete environment.NEXT_PUBLIC_FINGERLY_API_KEY
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(renderToString(<FingerlyProvider><span>page</span></FingerlyProvider>)).toContain('page')
  })
})
