/**
 * @vitest-environment node
 *
 * Server-side rendering.
 *
 * Deliberately in the `node` environment with no DOM at all, because that is
 * what a Nuxt server render actually is. A test that ran this under happy-dom
 * would have a `window` and would prove nothing.
 */

import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@fingerly/web-js', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
}))

const { createFingerly, FingerlyServerError } = await import('../src/plugin.js')
const { useIdentify } = await import('../src/useIdentify.js')

beforeEach(() => {
  vi.clearAllMocks()
  identifyMock.mockResolvedValue({ requestId: 'req_1', report: {} })
  loadMock.mockResolvedValue({ identify: identifyMock })
})

describe('under SSR', () => {
  it('has no window, so the premise of these tests holds', () => {
    expect(typeof window).toBe('undefined')
  })

  it('renders a page that uses immediate, without collecting anything', async () => {
    const Page = defineComponent({
      setup() {
        const { isReady, isSuspicious } = useIdentify({ immediate: true })
        return () => h('div', `ready:${isReady.value} suspicious:${isSuspicious.value}`)
      },
    })

    const app = createSSRApp(Page)
    app.use(createFingerly({ apiKey: 'fly_pk_development_test' }))

    const html = await renderToString(app)

    // `immediate` runs in onMounted, which SSR never calls. The page renders
    // its "not yet identified" state and the client picks it up on hydration.
    expect(html).toBe('<div>ready:false suspicious:null</div>')
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('rejects a direct identify() with a message that says what to do', async () => {
    let captured: unknown
    await renderToString(
      createSSRApp(
        defineComponent({
          setup() {
            const { identify } = useIdentify()
            // Awaiting is not possible in a sync setup, so the rejection is
            // captured rather than awaited; what matters is which error it is.
            identify().catch((error: unknown) => {
              captured = error
            })
            return () => h('div')
          },
        }),
      ).use(createFingerly({ apiKey: 'fly_pk_development_test' })),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(captured).toBeInstanceOf(FingerlyServerError)
    expect((captured as Error).message).toMatch(/cannot run during server-side rendering/)
    expect((captured as Error).message).toMatch(/immediate: true/)
  })
})
