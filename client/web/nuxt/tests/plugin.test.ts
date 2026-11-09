/**
 * The runtime plugin, installed into a real Vue app.
 *
 * `#app` is aliased to a stub, so this is the plugin file that ships rather
 * than a copy of its body. `@fingerly/web-js` is mocked, because what is under
 * test is the wiring - does a component that Nuxt would auto-import
 * `useIdentify()` into reach a client configured from the runtime config - and
 * not whether a canvas hashes.
 */

import { createApp, defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@fingerly/web-js', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
  ConsentError: class ConsentError extends Error {},
}))

/** The part of a client the Vue plugin talks to, with consent that notifies as the real one does. */
function fakeClient(options: { consent?: string } = {}) {
  const listeners = new Set<(state: string) => void>()
  const client = {
    consent: options.consent ?? 'pending',
    identify: identifyMock,
    setConsent: (state: string) => {
      if (state === client.consent) return
      client.consent = state
      for (const listener of [...listeners]) listener(state)
    },
    onConsentChange: (listener: (state: string) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return client
}

const { useFingerly, useIdentify, useVerdict } = await import('@fingerly/vue')
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
  loadMock.mockImplementation(async (options: { consent?: string }) => fakeClient(options))
  __setRuntimeConfig({ fingerly: { apiKey: 'pk_runtime' } })
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
      fingerly: { apiKey: 'pk_runtime', endpoint: 'https://fingerly.internal', consent: 'granted' },
    })

    const { identify } = mountWithPlugin(() => useIdentify())
    await identify()

    expect(loadMock).toHaveBeenCalledWith({
      apiKey: 'pk_runtime',
      endpoint: 'https://fingerly.internal',
      consent: 'granted',
    })
  })

  it('defaults consent to pending, so nothing identifies on mount', async () => {
    __setRuntimeConfig({ fingerly: { apiKey: 'pk_runtime' } })

    const identify = mountWithPlugin(() => useIdentify({ immediate: true }))
    await Promise.resolve()

    expect(identify.consent.value).toBe('pending')
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('takes consent from the runtime config, and identifies on mount only once it is granted', async () => {
    __setRuntimeConfig({ fingerly: { apiKey: 'pk_runtime', consent: 'pending' } })

    const { identify, fingerly } = mountWithPlugin(() => ({
      identify: useIdentify({ immediate: true }),
      fingerly: useFingerly(),
    }))
    await Promise.resolve()

    expect(loadMock).not.toHaveBeenCalled()
    expect(identify.consent.value).toBe('pending')

    fingerly.setConsent('granted')
    await vi.waitFor(() => expect(identify.requestId.value).toBe('req_1'))

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_runtime', consent: 'granted' })
    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('passes submit through, so an app can score without sending', async () => {
    __setRuntimeConfig({ fingerly: { apiKey: 'pk_runtime', submit: false } })
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
    expect(second.verdicts.value?.incognito.value).toBeNull()
  })

  it('still installs with no key, and says so once', async () => {
    // The key can arrive from the environment after the build. Refusing to
    // install would make every useIdentify() in the app fail with "no plugin
    // found", which points at wiring that is correct.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    __setRuntimeConfig({ fingerly: { apiKey: '' } })

    const { identify } = mountWithPlugin(() => useIdentify())

    expect(warn.mock.calls[0]?.[0]).toMatch(/NUXT_PUBLIC_FINGERLY_API_KEY/)
    expect(loadMock).not.toHaveBeenCalled()

    // And the failure lands where somebody is looking for it.
    loadMock.mockRejectedValue(new Error('An SDK key is required to submit a fingerprint'))
    await expect(identify()).rejects.toThrow(/SDK key is required/)
  })

  it('prefers endpoints when the environment also sets the deprecated endpoint', async () => {
    // fingerly.endpoints in nuxt.config.ts plus NUXT_PUBLIC_FINGERLY_ENDPOINT
    // used to reach the SDK as both, which it refuses.
    __setRuntimeConfig({
      fingerly: { apiKey: 'pk_runtime', endpoint: '/from-env', endpoints: ['/k7x2qm4a'], consent: 'granted' },
    })

    const { identify } = mountWithPlugin(() => useIdentify())
    await identify()

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_runtime', endpoints: ['/k7x2qm4a'], consent: 'granted' })
  })

  it('warns about a missing key once per process, not once per render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    __setRuntimeConfig({ fingerly: { apiKey: '' } })

    for (let i = 0; i < 5; i++) mountWithPlugin(() => useIdentify())

    expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('tolerates a runtime config with no fingerly block', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    __setRuntimeConfig({})

    expect(() => mountWithPlugin(() => useIdentify())).not.toThrow()
  })
})

// The server's answers, through the real client rather than a fake result:
// mapping them is exactly what is under test.
const OLD_TRIGGER = { signal: 'automation', group: 'bot', weight: 9, confidence: 'high', reason: 'cdp-artifacts-1' }
const PUBLIC_ANSWERS = [
  ['score and no triggers', { suspect_score: 7, suspect_level: 'low' }, 7, 'low', false, 0],
  ['neither score nor triggers', {}, null, null, null, 0],
  ['an old shape with triggers', { suspect_score: 22, suspect_level: 'medium', triggers: [OLD_TRIGGER] }, 22, 'medium', true, 1],
] as const

async function answering(answer: Record<string, unknown>) {
  const { FingerlyClient } = await import('@fingerly/web-js')
  const transport = { submit: async () => ({ request_id: 'req_public', ...answer }) }
  loadMock.mockImplementation(
    async () => new FingerlyClient({ apiKey: 'fly_pk_development_test', consent: 'granted', transport, sources: [] }),
  )
}

describe('a public response', () => {
  it.each(PUBLIC_ANSWERS)('%s: absent stays null and verdicts report nothing', async (_name, answer, score, level, suspicious, triggers) => {
    await answering(answer)
    __setRuntimeConfig({ fingerly: { apiKey: 'pk_runtime', consent: 'granted' } })

    const { identify, automation } = mountWithPlugin(() => ({ identify: useIdentify(), automation: useVerdict('automation') }))
    await identify.identify()

    expect(identify.error.value).toBeNull()
    expect(identify.requestId.value).toBe('req_public')
    expect(identify.suspectScore.value).toBe(score)
    expect(identify.suspectLevel.value).toBe(level)
    expect(identify.isSuspicious.value).toBe(suspicious)
    expect(identify.triggers.value).toHaveLength(triggers)
    expect(automation.verdict.value?.value).toBeNull()
    expect(automation.matched.value).toBeNull()
  })
})
