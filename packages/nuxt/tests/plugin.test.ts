/**
 * The runtime plugin, installed into a real Vue app.
 *
 * `#app` is aliased to a stub, so this is the plugin file that ships rather
 * than a copy of its body. `@badele/web-js` is mocked, because what is under
 * test is the wiring - does a component that Nuxt would auto-import
 * `useIdentify()` into reach a client configured from the runtime config - and
 * not whether a canvas hashes.
 */

import { createApp, defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@badele/web-js', () => ({
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
}))

const { useIdentify } = await import('@badele/vue')
const { __setRuntimeConfig } = await import('./stubs/nuxt-app.js')
const plugin = (await import('../src/runtime/plugin.js')).default

const RESULT = {
  requestId: 'req_1',
  verdicts: { incognito: { value: true, confidence: 'medium', reasons: ['firefox-private'] } },
  report: { schema: 1, sources: {}, elapsed_ms: 18 },
}

/**
 * Do what Nuxt does: install the plugin on an app, then mount a component
 * that uses the composable.
 */
function mountWithPlugin<T>(use: () => T): T {
  let result!: T

  const app = createApp(
    defineComponent({
      setup() {
        result = use()
        return () => h('div')
      },
    }),
  )

  plugin({ vueApp: app })
  app.mount(document.createElement('div'))

  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  identifyMock.mockResolvedValue(RESULT)
  loadMock.mockResolvedValue({ identify: identifyMock })
  __setRuntimeConfig({ badele: { apiKey: 'pk_runtime' } })
})

describe('the runtime plugin', () => {
  it('installs nothing that collects', () => {
    mountWithPlugin(() => useIdentify())

    // Installing makes the client reachable and no more. A plugin that
    // collected on install would run during the server render.
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('builds the client from the runtime config', async () => {
    __setRuntimeConfig({
      badele: { apiKey: 'pk_runtime', endpoint: 'https://badele.internal' },
    })

    const { identify } = mountWithPlugin(() => useIdentify())
    await identify()

    expect(loadMock).toHaveBeenCalledWith({
      apiKey: 'pk_runtime',
      endpoint: 'https://badele.internal',
    })
  })

  it('passes submit through, so an app can score without sending', async () => {
    __setRuntimeConfig({ badele: { apiKey: 'pk_runtime', submit: false } })
    // What the client returns when it sent nothing, and what the composable
    // has to turn back into null - there is no receipt to fetch later.
    identifyMock.mockResolvedValue({ ...RESULT, requestId: '' })

    const { identify, requestId } = mountWithPlugin(() => useIdentify())
    await identify()

    expect(identifyMock).toHaveBeenCalledWith({ submit: false })
    expect(requestId.value).toBeNull()
  })

  it('shares one identification across the app, as the Vue plugin does', async () => {
    let first!: ReturnType<typeof useIdentify>
    let second!: ReturnType<typeof useIdentify>

    const app = createApp(
      defineComponent({
        setup() {
          first = useIdentify()
          second = useIdentify()
          return () => h('div')
        },
      }),
    )
    plugin({ vueApp: app })
    app.mount(document.createElement('div'))

    await Promise.all([first.identify(), second.identify()])

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(second.verdicts.value?.incognito.value).toBe(true)
  })

  it('still installs with no key, and says so once', async () => {
    // The key can arrive from the environment after the build. Refusing to
    // install would make every useIdentify() in the app fail with "no plugin
    // found", which points at wiring that is correct.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    __setRuntimeConfig({ badele: { apiKey: '' } })

    const { identify } = mountWithPlugin(() => useIdentify())

    expect(warn.mock.calls[0]?.[0]).toMatch(/NUXT_PUBLIC_BADELE_API_KEY/)
    expect(loadMock).not.toHaveBeenCalled()

    // And the failure lands where somebody is looking for it.
    loadMock.mockRejectedValue(new Error('An SDK key is required to submit a fingerprint'))
    await expect(identify()).rejects.toThrow(/SDK key is required/)
  })

  it('tolerates a runtime config with no badele block', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    __setRuntimeConfig({})

    expect(() => mountWithPlugin(() => useIdentify())).not.toThrow()
  })
})
