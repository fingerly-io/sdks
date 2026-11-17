/**
 * Consent never comes from deployment configuration.
 *
 * Consent is the visitor's answer. A value in `nuxt.config.ts` or in
 * `NUXT_PUBLIC_FINGERLY_CONSENT` would apply to every visitor before any of
 * them answered, and the SDK would then touch storage and submit on mount. So
 * neither reaches the client: it starts `pending`, and only a runtime
 * `setConsent()` moves it. `load` is mocked; nothing is sent.
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { createApp, defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@fingerly/web-js', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  load: (...args: unknown[]) => loadMock(...args),
}))

const { useFingerly, useIdentify } = await import('@fingerly/vue')
const { __setRuntimeConfig } = await import('./stubs/nuxt-app.js')
const plugin = (await import('../src/runtime/plugin.js')).default
const { resolvePublicConfig } = await import('../src/options.js')
const { toVueOptions } = await import('../src/runtime/config.js')

/** A client whose consent notifies, as the real one does. */
function fakeClient(options: { consent?: string }) {
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

function mountImmediate() {
  let result!: { identify: ReturnType<typeof useIdentify>; fingerly: ReturnType<typeof useFingerly> }
  const app = createApp(
    defineComponent({
      setup() {
        result = { identify: useIdentify({ immediate: true }), fingerly: useFingerly() }
        return () => h('div')
      },
    }),
  )
  plugin({ vueApp: app })
  app.mount(document.createElement('div'))
  return result
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** Nitro's own environment override, the function Nuxt runs at server start. */
async function nitroApplyEnv(): Promise<((obj: unknown, opts: unknown) => unknown) | undefined> {
  try {
    const require = createRequire(import.meta.url)
    const nuxtPkg = require.resolve('nuxt/package.json')
    const nitroPkg = createRequire(nuxtPkg).resolve('nitropack/package.json')
    const file = nitroPkg.replace(/package\.json$/, 'dist/runtime/internal/utils.env.mjs')
    const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { applyEnv?: never }
    return mod.applyEnv
  } catch {
    return undefined
  }
}

describe('consent from deployment configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    identifyMock.mockResolvedValue({ requestId: 'r' })
    loadMock.mockImplementation(async (options: { consent?: string }) => fakeClient(options))
  })
  afterEach(() => {
    delete process.env.NUXT_PUBLIC_FINGERLY_CONSENT
  })

  it('does not publish `consent: "granted"` from nuxt.config, and the client options carry none', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const published = resolvePublicConfig({ apiKey: 'fly_pk_development_test', consent: 'granted' }, undefined)
      expect(published).not.toHaveProperty('consent')
      expect(toVueOptions(published)).not.toHaveProperty('consent')
    } finally {
      warn.mockRestore()
    }
  })

  it('gives NUXT_PUBLIC_FINGERLY_CONSENT=granted nothing to override', async () => {
    const published = resolvePublicConfig({ apiKey: 'fly_pk_development_test' }, undefined)
    expect(Object.keys(published)).not.toContain('consent')

    process.env.NUXT_PUBLIC_FINGERLY_CONSENT = 'granted'
    const runtime: { public: { fingerly: Record<string, unknown> } } = { public: { fingerly: { ...published } } }
    const applyEnv = await nitroApplyEnv()
    if (applyEnv) applyEnv(runtime, { prefix: 'NITRO_', altPrefix: 'NUXT_' })

    // Nitro only overrides keys that exist, so the variable lands nowhere.
    expect(runtime.public.fingerly).not.toHaveProperty('consent')
    expect(toVueOptions(runtime.public.fingerly as never)).not.toHaveProperty('consent')
  })

  it('ignores a consent value placed in the runtime config by hand', () => {
    const merged = resolvePublicConfig({}, { apiKey: 'pk', consent: 'granted' } as never)
    expect(merged).not.toHaveProperty('consent')
    expect(toVueOptions({ apiKey: 'pk', consent: 'granted' } as never)).not.toHaveProperty('consent')
  })

  it('starts pending on mount even when the runtime config says granted, and identifies only after setConsent()', async () => {
    __setRuntimeConfig({ fingerly: { apiKey: 'fly_pk_development_test', consent: 'granted' } })

    const { identify, fingerly } = mountImmediate()
    await flush()

    expect(identify.consent.value).toBe('pending')
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()

    // The runtime call a consent tool makes after the visitor answered.
    fingerly.setConsent('granted')
    await vi.waitFor(() => expect(identifyMock).toHaveBeenCalledTimes(1))
    expect(loadMock.mock.calls[0]?.[0]?.consent).toBe('granted')
  })
})
