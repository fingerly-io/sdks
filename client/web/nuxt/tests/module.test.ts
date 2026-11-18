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
      continuity: 'none',
    })
  })

  it('publishes session continuity from the options, and lets the environment override it', () => {
    const configured = nuxtWith()
    module_.setup({ apiKey: 'pk', continuity: 'session' }, configured)
    expect(fingerlyConfig(configured)).toMatchObject({ continuity: 'session' })

    const environment = nuxtWith({ fingerly: { continuity: 'session' } })
    module_.setup({ apiKey: 'pk', continuity: 'none' }, environment)
    expect(fingerlyConfig(environment)).toMatchObject({ continuity: 'session' })

    const empty = nuxtWith({ fingerly: { continuity: '' } })
    module_.setup({ apiKey: 'pk', continuity: 'session' }, empty)
    expect(fingerlyConfig(empty)).toMatchObject({ continuity: 'session' })
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
      continuity: 'none',
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
      continuity: 'none',
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
      continuity: 'none',
    })
  })

  it('publishes every key, so each one is overridable from the environment', () => {
    const nuxt = nuxtWith()
    module_.setup({ apiKey: 'pk' }, nuxt)

    expect(Object.keys(fingerlyConfig(nuxt) as object).sort()).toEqual([
      'apiKey',
      'apiVersion',
      'continuity',
      'endpoints',
      'fallbackToDefaultEndpoint',
      'incognitoDetection',
    ])
  })

  it('never publishes consent, from the options or from an existing runtime config', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const configured = nuxtWith()
      module_.setup({ apiKey: 'pk', consent: 'granted' }, configured)
      expect(fingerlyConfig(configured)).not.toHaveProperty('consent')

      const environment = nuxtWith({ fingerly: { consent: 'granted' } })
      module_.setup({ apiKey: 'pk' }, environment)
      expect(fingerlyConfig(environment)).not.toHaveProperty('consent')
    } finally {
      warn.mockRestore()
    }
  })

  it('warns at build time when consent is set in nuxt.config, and not otherwise', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      module_.setup({ apiKey: 'pk' }, nuxtWith())
      module_.setup({ apiKey: 'pk', consent: 'pending' }, nuxtWith())
      expect(warn).not.toHaveBeenCalled()

      module_.setup({ apiKey: 'pk', consent: 'granted' }, nuxtWith())
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('setConsent()')
    } finally {
      warn.mockRestore()
    }
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
      continuity: 'none',
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
