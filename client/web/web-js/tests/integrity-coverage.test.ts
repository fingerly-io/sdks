// @vitest-environment happy-dom
//
// WEB-04 and WEB-03: what the integrity layer inspects, a wrapped navigator,
// a replaced borrow primitive, and a pass that must never reject identify().

import { afterEach, describe, expect, it, vi } from 'vitest'

import { load } from '../src/index.js'
import { findRedefinedProperties } from '../src/lies/descriptors.js'
import {
  borrowRealmToString,
  createRealmStringifier,
  findPatchedNatives,
  INITIAL_FN_TO_STRING,
} from '../src/lies/natives.js'

type AnyWindow = Window & typeof globalThis

/** A navigator/screen pair whose getters check their receiver, as WebIDL does. */
function brandedWindow() {
  const sources = new Map<unknown, string>()
  const brand = Symbol('brand')
  const getter = (prop: string, value: unknown) => {
    const fn = function (this: Record<symbol, boolean>) {
      if (!this || this[brand] !== true) throw new TypeError('Illegal invocation')
      return value
    }
    Object.defineProperty(fn, 'name', { value: `get ${prop}` })
    sources.set(fn, `function get ${prop}() { [native code] }`)
    return fn
  }
  class Navigator {}
  class Screen {}
  const navValues: Record<string, unknown> = {
    webdriver: false,
    userAgent: 'REAL-UA',
    platform: 'REAL-PLATFORM',
    plugins: [],
    mimeTypes: [],
    languages: ['en-US'],
    language: 'en-US',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    vendor: 'v',
    appVersion: '5.0',
    productSub: '20030107',
  }
  for (const [prop, value] of Object.entries(navValues)) {
    Object.defineProperty(Navigator.prototype, prop, { get: getter(prop, value), configurable: true })
  }
  for (const prop of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth']) {
    Object.defineProperty(Screen.prototype, prop, { get: getter(prop, 100), configurable: true })
  }
  const navigator = Object.create(Navigator.prototype)
  navigator[brand] = true
  const screen = Object.create(Screen.prototype)
  screen[brand] = true
  const stringify = createRealmStringifier(function (this: unknown) {
    return sources.get(this) ?? INITIAL_FN_TO_STRING.call(this as never)
  })
  return { w: { navigator, screen, Navigator, Screen } as unknown as AnyWindow, stringify }
}

describe('what the layer inspects (WEB-04 item 4, WEB-03)', () => {
  it('covers every API the finding listed', () => {
    const failing = () => ({ ok: false }) as const
    const all = new Set(findPatchedNatives({} as AnyWindow, { stringify: failing, clean: true }).lies.map((l) => l.id))

    const asked: string[] = []
    const recorder = (holder: string) =>
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor(_t, p) {
            asked.push(`${holder}.${String(p)}`)
            return undefined
          },
          getPrototypeOf: () => null,
        },
      )
    findRedefinedProperties(
      { navigator: recorder('navigator'), screen: recorder('screen') } as unknown as AnyWindow,
      createRealmStringifier(),
    )
    const inspected = [...all, ...asked]

    for (const api of [
      'Math.',
      'resolvedOptions',
      'devicePixelRatio',
      'matchMedia',
      'getHighEntropyValues',
      'getDirectory',
      'getShaderPrecisionFormat',
      'getSupportedExtensions',
      'OffscreenCanvas',
      'Worker',
      'Blob',
      'createObjectURL',
      'createElement',
      'appendChild',
      'contentWindow',
      'window.navigator',
      'window.screen',
      'screen.pixelDepth',
    ]) {
      expect(inspected.some((id) => id.includes(api)), api).toBe(true)
    }
  })

  it('reports a replaced Worker, Blob or createObjectURL (WEB-03)', () => {
    const { stringify } = brandedWindow()
    const wrapper = function Worker() {}
    const w = {
      Worker: wrapper,
      Blob: () => undefined,
      URL: { createObjectURL: new Proxy(() => '', {}) },
    } as unknown as AnyWindow
    const lies = findPatchedNatives(w, { stringify, clean: true }).lies
    for (const id of ['Worker', 'Blob', 'URL.createObjectURL']) {
      expect(lies, id).toContainEqual({ id, kind: 'not-native' })
    }
  })
})

describe('a wrapped navigator (WEB-04 item 1)', () => {
  it('a Proxy that changes a read is a contradiction', () => {
    const { w, stringify } = brandedWindow()
    expect(findRedefinedProperties(w, stringify)).toEqual([])

    const real = w.navigator
    const wrapped = new Proxy(real, {
      get: (target, prop) => (prop === 'userAgent' ? 'CHANGED-UA' : Reflect.get(target, prop, target)),
    })
    ;(w as unknown as { navigator: unknown }).navigator = wrapped

    expect(findRedefinedProperties(w, stringify)).toContainEqual({
      id: 'navigator.userAgent',
      kind: 'contradiction',
      detail: 'read-differs-from-getter',
    })
  })

  it('a wrapper the native getter refuses as a receiver is a brand lie', () => {
    const { w, stringify } = brandedWindow()
    // A wrapper that does not forward the brand, as a real Proxy is refused
    // by a real WebIDL getter.
    ;(w as unknown as { navigator: unknown }).navigator = new Proxy(
      {},
      { getPrototypeOf: () => w.Navigator.prototype, get: () => 'x' },
    )
    expect(findRedefinedProperties(w, stringify)).toContainEqual({
      id: 'navigator',
      kind: 'brand',
      detail: 'receiver-rejected',
    })
  })

  it('reads no values when told not to (embedded profile)', () => {
    const { w, stringify } = brandedWindow()
    ;(w as unknown as { navigator: unknown }).navigator = new Proxy(w.navigator, {
      get: (target, prop) => (prop === 'userAgent' ? 'CHANGED-UA' : Reflect.get(target, prop, target)),
    })
    expect(findRedefinedProperties(w, stringify, { readValues: false })).toEqual([])
  })

  it('a window.navigator replaced by a plain value is not native', () => {
    const { stringify } = brandedWindow()
    const w = { navigator: {} } as unknown as AnyWindow
    expect(findPatchedNatives(w, { stringify, clean: true }).lies).toContainEqual({
      id: 'window.navigator',
      kind: 'not-native',
    })
  })
})

describe('the borrow primitives (WEB-04 item 2)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('a replaced contentWindow getter leaves the realm unverified', () => {
    const proto = (window as unknown as { HTMLIFrameElement: { prototype: object } }).HTMLIFrameElement.prototype
    const original = Object.getOwnPropertyDescriptor(proto, 'contentWindow')
    const calls: unknown[] = []
    Object.defineProperty(proto, 'contentWindow', {
      configurable: true,
      get: () => ({
        Function: {
          prototype: {
            toString(this: unknown) {
              calls.push(this)
              return 'function anything() { [native code] }'
            },
          },
        },
      }),
    })
    try {
      const realm = borrowRealmToString()
      expect(realm.clean).toBe(false)
      const report = findPatchedNatives({} as AnyWindow, realm)
      expect(report.lies.filter((l) => l.kind === 'unverified_realm')).toHaveLength(1)
      // The substitute was never used as the authority.
      expect(calls).toEqual([])
    } finally {
      if (original) Object.defineProperty(proto, 'contentWindow', original)
      else delete (proto as Record<string, unknown>).contentWindow
    }
  })
})

describe('a throwing getter never rejects identify() (WEB-04 item 5)', () => {
  const submit = vi.fn(async () => ({ request_id: 'r1' }))

  afterEach(() => {
    submit.mockClear()
  })

  async function client() {
    return load({
      apiKey: 'fly_pk_development_test',
      consent: 'granted',
      transport: { submit } as never,
      sources: [{ id: 'plain', run: () => 1 } as never],
    })
  }

  it('document.body', async () => {
    const c = await client()
    Object.defineProperty(document, 'body', {
      configurable: true,
      get() {
        throw new Error('body getter')
      },
    })
    try {
      await expect(c.identify()).resolves.toMatchObject({ requestId: 'r1' })
    } finally {
      delete (document as unknown as Record<string, unknown>).body
    }
    expect(submit).toHaveBeenCalledTimes(1)
    const body = (submit.mock.calls[0] as unknown[])[0] as { signals: { integrity: { lies: unknown[] } } }
    expect(body.signals.integrity.lies).toContainEqual(
      expect.objectContaining({ kind: 'unverified_realm' }),
    )
  })

  it('window.Navigator', async () => {
    const c = await client()
    const original = Object.getOwnPropertyDescriptor(window, 'Navigator')
    Object.defineProperty(window, 'Navigator', {
      configurable: true,
      get() {
        throw new Error('Navigator getter')
      },
    })
    try {
      await expect(c.identify()).resolves.toMatchObject({ requestId: 'r1' })
    } finally {
      if (original) Object.defineProperty(window, 'Navigator', original)
    }
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
