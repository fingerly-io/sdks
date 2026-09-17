/**
 * The module, as Nuxt calls it.
 *
 * `@nuxt/kit` is mocked down to the four functions used, and `setup()` is
 * called with a Nuxt-shaped object. What is under test is what the module does
 * to that object - the runtime config it publishes, the plugin it registers,
 * the composables it auto-imports - not whether kit works.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const addPlugin = vi.fn()
const addImports = vi.fn()

vi.mock('@nuxt/kit', () => ({
  // Handed straight back, so the test can call `setup()` itself.
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
    module_.setup({ apiKey: 'pk_from_config', submit: false }, nuxt)

    expect(fingerlyConfig(nuxt)).toEqual({
      apiKey: 'pk_from_config',
      apiVersion: 'v1',
      endpoint: '',
      endpoints: [],
      fallbackToDefaultEndpoint: false,
      submit: false,
      consent: 'granted',
    })
  })

  it('survives a runtime config with no public block at all', () => {
    const nuxt = nuxtWith()
    expect(() => module_.setup({ apiKey: 'pk' }, nuxt)).not.toThrow()
    expect(fingerlyConfig(nuxt)).toEqual({
      apiKey: 'pk', apiVersion: 'v1', endpoint: '', endpoints: [], fallbackToDefaultEndpoint: false, submit: true, consent: 'granted',
    })
  })

  it('lets the runtime config win, because that is what the environment sets', () => {
    // NUXT_PUBLIC_FINGERLY_API_KEY lands here, and it is read when the server
    // starts rather than when the bundle is built. One build, promoted through
    // staging and production, keyed differently in each.
    const nuxt = nuxtWith({ fingerly: { apiKey: 'pk_from_environment' } })
    module_.setup({ apiKey: 'pk_from_config' }, nuxt)

    expect(fingerlyConfig(nuxt)).toEqual({
      apiKey: 'pk_from_environment',
      apiVersion: 'v1',
      endpoint: '',
      endpoints: [],
      fallbackToDefaultEndpoint: false,
      submit: true,
      consent: 'granted',
    })
  })

  it('treats an empty environment value as absent', () => {
    // Nuxt fills the key with an empty string when the variable is unset, so
    // "present but empty" is the ordinary case rather than a strange one.
    const nuxt = nuxtWith({ fingerly: { apiKey: '' } })
    module_.setup({ apiKey: 'pk_from_config' }, nuxt)

    expect(fingerlyConfig(nuxt)).toEqual({
      apiKey: 'pk_from_config',
      apiVersion: 'v1',
      endpoint: '',
      endpoints: [],
      fallbackToDefaultEndpoint: false,
      submit: true,
      consent: 'granted',
    })
  })

  it('publishes every key, so each one is overridable from the environment', () => {
    // Nuxt only overrides runtime config keys that already exist, so an
    // omitted `submit` is a NUXT_PUBLIC_FINGERLY_SUBMIT that silently does
    // nothing. Present-and-empty is how "not set" is spelled.
    const nuxt = nuxtWith()
    module_.setup({ apiKey: 'pk' }, nuxt)

    expect(Object.keys(fingerlyConfig(nuxt) as object).sort()).toEqual([
      'apiKey', 'apiVersion', 'consent', 'endpoint', 'endpoints', 'fallbackToDefaultEndpoint', 'submit',
    ])
  })

  it('publishes consent, and lets the environment override it', () => {
    const configured = nuxtWith()
    module_.setup({ apiKey: 'pk', consent: 'pending' }, configured)
    expect(fingerlyConfig(configured)).toMatchObject({ consent: 'pending' })

    const overridden = nuxtWith({ fingerly: { consent: 'denied' } })
    module_.setup({ apiKey: 'pk', consent: 'pending' }, overridden)
    expect(fingerlyConfig(overridden)).toMatchObject({ consent: 'denied' })
  })

  it('does not fail the build when no key is configured anywhere', () => {
    // The key can legitimately arrive later, from the deployment environment.
    // The runtime plugin is what says something about an empty one.
    const nuxt = nuxtWith()
    module_.setup({}, nuxt)

    expect(fingerlyConfig(nuxt)).toEqual({
      apiKey: '', apiVersion: 'v1', endpoint: '', endpoints: [], fallbackToDefaultEndpoint: false, submit: true, consent: 'granted',
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
      { name: 'useVerdict', from: '@fingerly/vue' },
    ])
  })
})
