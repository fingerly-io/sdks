/**
 * The module, as Nuxt calls it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const addPlugin = vi.fn()
const addImports = vi.fn()

vi.mock('@nuxt/kit', () => ({
  defineNuxtModule: (definition: unknown) => definition,
  createResolver: () => ({ resolve: (path: string) => `/modules/fingerly/${path}` }),
  addPlugin: (...args: unknown[]) => addPlugin(...args),
  addImports: (...args: unknown[]) => addImports(...args),
}))

const module_ = (await import('../src/module.js')).default as unknown as {
  meta: { name: string; configKey: string; compatibility: { nuxt: string } }
  defaults: Record<string, unknown>
  setup: (options: Record<string, unknown>, nuxt: FakeNuxt) => void
}

interface FakeNuxt {
  options: { runtimeConfig: { public?: Record<string, unknown> } }
}

const nuxtWith = (publicConfig?: Record<string, unknown>): FakeNuxt => ({
  options: { runtimeConfig: publicConfig === undefined ? {} : { public: publicConfig } },
})

const fingerlyConfig = (nuxt: FakeNuxt) => nuxt.options.runtimeConfig.public?.fingerly

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the module', () => {
  it('registers under the fingerly config key', () => {
    expect(module_.meta.configKey).toBe('fingerly')
    expect(module_.meta.name).toBe('@fingerly/nuxt')
    expect(module_.meta.compatibility.nuxt).toBe('>=3.0.0')
  })

  it('publishes its options to the public runtime config', () => {
    const nuxt = nuxtWith()
    module_.setup({ apiKey: 'pk_from_config', incognitoDetection: 'extended' }, nuxt)

    expect(fingerlyConfig(nuxt)).toEqual({
      apiKey: 'pk_from_config',
      apiVersion: 'v1',
      endpoints: [],
      fallbackToDefaultEndpoint: false,
      incognitoDetection: 'extended',
      consent: 'pending',
    })
  })

  it('survives a runtime config with no public block at all', () => {
    const nuxt = nuxtWith()
    expect(() => module_.setup({ apiKey: 'pk' }, nuxt)).not.toThrow()
    expect(fingerlyConfig(nuxt)).toEqual({
      apiKey: 'pk',
      apiVersion: 'v1',
      endpoints: [],
      fallbackToDefaultEndpoint: false,
      incognitoDetection: 'standard',
      consent: 'pending',
    })
  })

  it('lets the runtime config win, because that is what the environment sets', () => {
    const nuxt = nuxtWith({ fingerly: { apiKey: 'pk_from_environment' } })
    module_.setup({ apiKey: 'pk_from_config' }, nuxt)

    expect(fingerlyConfig(nuxt)).toEqual({
      apiKey: 'pk_from_environment',
      apiVersion: 'v1',
      endpoints: [],
      fallbackToDefaultEndpoint: false,
      incognitoDetection: 'standard',
      consent: 'pending',
    })
  })

  it('treats an empty environment value as absent', () => {
    const nuxt = nuxtWith({ fingerly: { apiKey: '' } })
    module_.setup({ apiKey: 'pk_from_config' }, nuxt)

    expect(fingerlyConfig(nuxt)).toEqual({
      apiKey: 'pk_from_config',
      apiVersion: 'v1',
      endpoints: [],
      fallbackToDefaultEndpoint: false,
      incognitoDetection: 'standard',
      consent: 'pending',
    })
  })

  it('publishes every key, so each one is overridable from the environment', () => {
    const nuxt = nuxtWith()
    module_.setup({ apiKey: 'pk' }, nuxt)

    expect(Object.keys(fingerlyConfig(nuxt) as object).sort()).toEqual([
      'apiKey',
      'apiVersion',
      'consent',
      'endpoints',
      'fallbackToDefaultEndpoint',
      'incognitoDetection',
    ])
  })

  it('publishes consent, and lets the environment override it', () => {
    const configured = nuxtWith()
    module_.setup({ apiKey: 'pk', consent: 'granted' }, configured)
    expect(fingerlyConfig(configured)).toMatchObject({ consent: 'granted' })

    const overridden = nuxtWith({ fingerly: { consent: 'denied' } })
    module_.setup({ apiKey: 'pk', consent: 'granted' }, overridden)
    expect(fingerlyConfig(overridden)).toMatchObject({ consent: 'denied' })
  })

  it('does not fail the build when no key is configured anywhere', () => {
    const nuxt = nuxtWith()
    module_.setup({}, nuxt)

    expect(fingerlyConfig(nuxt)).toEqual({
      apiKey: '',
      apiVersion: 'v1',
      endpoints: [],
      fallbackToDefaultEndpoint: false,
      incognitoDetection: 'standard',
      consent: 'pending',
    })
  })

  it('registers the plugin by path rather than bundling it', () => {
    module_.setup({ apiKey: 'pk' }, nuxtWith())

    expect(addPlugin).toHaveBeenCalledWith('/modules/fingerly/./runtime/plugin')
  })

  it('auto-imports the composables from @fingerly/vue', () => {
    module_.setup({ apiKey: 'pk' }, nuxtWith())

    expect(addImports.mock.calls.map(([call]) => call)).toEqual([
      { name: 'useFingerly', from: '@fingerly/vue' },
      { name: 'useIdentify', from: '@fingerly/vue' },
    ])
  })
})
