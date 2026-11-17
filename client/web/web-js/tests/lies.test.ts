/**
 * Hardened lie detection (`F-11`) tests:
 * - Module-init captured intrinsics (`Function.prototype.toString`,
 *   `Object.getOwnPropertyDescriptor`, `Object.getPrototypeOf`, `Reflect.apply`)
 * - Fresh-iframe `stringify` passed into `findRedefinedProperties` + `unverified_realm`
 * - Throwing `toString.call(fn)` recorded as `kind: 'to-string-threw'`
 * - Exact `function <expectedName>(` / `function get <prop>(` header AND
 *   `!fn.name.startsWith('bound ')` catching ES6 `Proxy` and `.bind()`
 * - Synchronous WebIDL invalid-receiver brand checks (`kind: 'brand'`)
 * - Expanded `TARGETS` (`WebGL2RenderingContext.prototype.getParameter`,
 *   `HTMLCanvasElement.prototype.getContext`, `OfflineAudioContext.prototype.startRendering`,
 *   `StorageManager.prototype.estimate`, `HTMLElement.prototype.offsetWidth`/`offsetHeight`)
 */

import type { SignalOutcome } from '@fingerly/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createRealmStringifier,
  findPatchedNatives,
  INITIAL_FN_TO_STRING,
} from '../src/lies/natives.js'
import { findRedefinedProperties } from '../src/lies/descriptors.js'
import { inspectIntegrity } from '../src/lies/index.js'

const ok = (value: unknown): SignalOutcome => ({ status: 'ok', ms: 1, value })

const CONTRADICTORY = {
  navigator: ok({
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    product_sub: '20100101',
    language: 'de-DE',
    languages: ['en-US'],
  }),
  engine: ok({ observed: 'chromium', claimed: 'webkit' }),
  errors: ok({ observed: 'gecko' }),
  webgl: ok({ unmasked_renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro)' }),
  screen: ok({ width: 800, inner_width: 1920 }),
  math: ok({ identities_hold: false }),
}

/**
 * Builds a minimal mock browser window using real V8 builtins (or WebIDL-branded
 * mocks whose `toString` answers through the supplied `nativeSources` map) so
 * each `F-11` tamper vector can be tested deterministically.
 */
function makeSyntheticWindow() {
  const nativeSources = new Map<unknown, string>()

  const makeBrandedMethod = (
    name: string,
    brandSymbol: symbol,
    impl: (...args: unknown[]) => unknown = () => null,
  ) => {
    const fn = function (this: Record<symbol, boolean>, ...args: unknown[]) {
      if (!this || this[brandSymbol] !== true) {
        throw new TypeError('Illegal invocation')
      }
      return impl(...args)
    }
    Object.defineProperty(fn, 'name', { value: name, configurable: true })
    nativeSources.set(fn, `function ${name}() { [native code] }`)
    return fn
  }

  const makeBrandedGetter = (prop: string, brandSymbol: symbol, value: unknown) => {
    const getter = function (this: Record<symbol, boolean>) {
      if (!this || this[brandSymbol] !== true) {
        throw new TypeError('Illegal invocation')
      }
      return value
    }
    Object.defineProperty(getter, 'name', { value: `get ${prop}`, configurable: true })
    nativeSources.set(getter, `function get ${prop}() { [native code] }`)
    return getter
  }

  const navBrand = Symbol('Navigator')
  const screenBrand = Symbol('Screen')
  const glBrand = Symbol('WebGL')
  const gl2Brand = Symbol('WebGL2')
  const canvasBrand = Symbol('HTMLCanvasElement')
  const ctx2dBrand = Symbol('CanvasRenderingContext2D')
  const audioBrand = Symbol('AudioBuffer')
  const offlineAudioBrand = Symbol('OfflineAudioContext')
  const storageBrand = Symbol('StorageManager')
  const elemBrand = Symbol('Element')
  const htmlElemBrand = Symbol('HTMLElement')
  const perfBrand = Symbol('Performance')
  const permBrand = Symbol('Permissions')
  const mediaBrand = Symbol('MediaDevices')

  class FakeNavigator {}
  Object.defineProperty(FakeNavigator, 'name', { value: 'Navigator' })
  nativeSources.set(FakeNavigator, 'function Navigator() { [native code] }')
  ;(FakeNavigator.prototype as Record<string, unknown>).javaEnabled = makeBrandedMethod(
    'javaEnabled',
    navBrand,
    () => false,
  )
  for (const [prop, val] of [
    ['webdriver', false],
    ['userAgent', 'Mozilla/5.0'],
    ['platform', 'MacIntel'],
    ['plugins', []],
    ['mimeTypes', []],
    ['languages', ['en-US']],
    ['language', 'en-US'],
    ['hardwareConcurrency', 8],
    ['deviceMemory', 8],
    ['maxTouchPoints', 0],
    ['vendor', 'Google Inc.'],
    ['appVersion', '5.0'],
    ['productSub', '20030107'],
  ] as const) {
    Object.defineProperty(FakeNavigator.prototype, prop, {
      get: makeBrandedGetter(prop, navBrand, val),
      configurable: true,
    })
  }
  const navigatorInstance = Object.create(FakeNavigator.prototype)
  navigatorInstance[navBrand] = true

  class FakeScreen {}
  Object.defineProperty(FakeScreen, 'name', { value: 'Screen' })
  nativeSources.set(FakeScreen, 'function Screen() { [native code] }')
  for (const [prop, val] of [
    ['width', 1920],
    ['height', 1080],
    ['availWidth', 1920],
    ['availHeight', 1055],
    ['colorDepth', 24],
    ['pixelDepth', 24],
    ['orientation', 'landscape-primary'],
  ] as const) {
    Object.defineProperty(FakeScreen.prototype, prop, {
      get: makeBrandedGetter(prop, screenBrand, val),
      configurable: true,
    })
  }
  const screenInstance = Object.create(FakeScreen.prototype)
  screenInstance[screenBrand] = true

  const makeCtor = (name: string, protoMembers: Record<string, unknown>, getters?: Record<string, PropertyDescriptor>) => {
    const Ctor = function () {}
    Object.defineProperty(Ctor, 'name', { value: name })
    nativeSources.set(Ctor, `function ${name}() { [native code] }`)
    Object.assign(Ctor.prototype, protoMembers)
    if (getters) Object.defineProperties(Ctor.prototype, getters)
    return Ctor
  }

  const WebGLRenderingContext = makeCtor('WebGLRenderingContext', {
    getParameter: makeBrandedMethod('getParameter', glBrand),
    getExtension: makeBrandedMethod('getExtension', glBrand),
    getShaderPrecisionFormat: makeBrandedMethod('getShaderPrecisionFormat', glBrand),
    getSupportedExtensions: makeBrandedMethod('getSupportedExtensions', glBrand),
  })
  const WebGL2RenderingContext = makeCtor('WebGL2RenderingContext', {
    getParameter: makeBrandedMethod('getParameter', gl2Brand),
  })
  const HTMLCanvasElement = makeCtor('HTMLCanvasElement', {
    getContext: makeBrandedMethod('getContext', canvasBrand),
    toDataURL: makeBrandedMethod('toDataURL', canvasBrand),
  })
  const CanvasRenderingContext2D = makeCtor('CanvasRenderingContext2D', {
    getImageData: makeBrandedMethod('getImageData', ctx2dBrand),
  })
  const OfflineAudioContext = makeCtor('OfflineAudioContext', {
    startRendering: makeBrandedMethod('startRendering', offlineAudioBrand),
  })
  const AudioBuffer = makeCtor('AudioBuffer', {
    getChannelData: makeBrandedMethod('getChannelData', audioBrand),
  })
  const StorageManager = makeCtor('StorageManager', {
    estimate: makeBrandedMethod('estimate', storageBrand),
    getDirectory: makeBrandedMethod('getDirectory', storageBrand),
  })
  const domBrand = Symbol('Document')
  const nodeBrand = Symbol('Node')
  const iframeBrand = Symbol('HTMLIFrameElement')
  const Document = makeCtor('Document', { createElement: makeBrandedMethod('createElement', domBrand) })
  const Node = makeCtor('Node', { appendChild: makeBrandedMethod('appendChild', nodeBrand) })
  const HTMLIFrameElement = makeCtor('HTMLIFrameElement', {}, {
    contentWindow: { get: makeBrandedGetter('contentWindow', iframeBrand, null), configurable: true },
  })
  const NavigatorUAData = makeCtor('NavigatorUAData', {
    getHighEntropyValues: makeBrandedMethod('getHighEntropyValues', Symbol('NavigatorUAData')),
  })
  const Worker = makeCtor('Worker', {})
  const Blob = makeCtor('Blob', {})
  const OffscreenCanvas = makeCtor('OffscreenCanvas', {})
  const createObjectURL = makeBrandedMethod('createObjectURL', Symbol('URL'))
  const matchMedia = makeBrandedMethod('matchMedia', Symbol('Window'))
  const Element = makeCtor('Element', {
    getBoundingClientRect: makeBrandedMethod('getBoundingClientRect', elemBrand),
  })
  const HTMLElement = makeCtor(
    'HTMLElement',
    {},
    {
      offsetWidth: { get: makeBrandedGetter('offsetWidth', htmlElemBrand, 100), configurable: true },
      offsetHeight: { get: makeBrandedGetter('offsetHeight', htmlElemBrand, 20), configurable: true },
    },
  )
  const Performance = makeCtor('Performance', {
    now: makeBrandedMethod('now', perfBrand, () => 0),
  })
  const Permissions = makeCtor('Permissions', {
    query: makeBrandedMethod('query', permBrand),
  })
  const MediaDevices = makeCtor('MediaDevices', {
    enumerateDevices: makeBrandedMethod('enumerateDevices', mediaBrand),
  })

  const stringify = createRealmStringifier(function (this: unknown) {
    if (nativeSources.has(this)) return nativeSources.get(this)!
    return INITIAL_FN_TO_STRING.call(this)
  })

  const windowBrand = Symbol('Window')
  const w = {
    [windowBrand]: true,
    Document,
    Node,
    HTMLIFrameElement,
    NavigatorUAData,
    Worker,
    Blob,
    OffscreenCanvas,
    URL: { createObjectURL },
    matchMedia,
    Navigator: FakeNavigator,
    Screen: FakeScreen,
    Permissions,
    MediaDevices,
    HTMLCanvasElement,
    CanvasRenderingContext2D,
    WebGLRenderingContext,
    WebGL2RenderingContext,
    OfflineAudioContext,
    AudioBuffer,
    StorageManager,
    Element,
    HTMLElement,
    Performance,
  } as unknown as Window & typeof globalThis
  // The window accessors are getters, as on a real window.
  for (const [prop, value] of [
    ['navigator', navigatorInstance],
    ['screen', screenInstance],
    ['devicePixelRatio', 2],
  ] as const) {
    Object.defineProperty(w, prop, { get: makeBrandedGetter(prop, windowBrand, value), configurable: true })
  }

  return { w, stringify, nativeSources }
}

describe('inspectIntegrity reports measurements only', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('computes no contradiction from sources that disagree when window is absent', () => {
    vi.stubGlobal('window', undefined)
    const report = inspectIntegrity(CONTRADICTORY)
    expect(report.lies).toEqual([])
    expect(report.patched_natives).toEqual([])
    expect(JSON.stringify(report)).not.toContain('contradiction')
  })

  it('reports the engine identity raw, with no agreement field', () => {
    vi.stubGlobal('window', undefined)
    const { engine } = inspectIntegrity(CONTRADICTORY)
    expect(engine).toEqual({ observed: 'chromium', claimed: 'webkit' })
  })
})

describe('F-11 hardened native, Proxy, bind, brand, and descriptor checks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('produces zero lies on a clean realm with all expanded TARGETS present', () => {
    const { w, stringify } = makeSyntheticWindow()
    const natives = findPatchedNatives(w, { stringify, clean: true })
    const descriptors = findRedefinedProperties(w, stringify)

    expect(natives.patched).toEqual([])
    expect(natives.lies).toEqual([])
    expect(descriptors).toEqual([])
  })

  it('emits unverified_realm when a fresh iframe realm could not be borrowed (!clean)', () => {
    const { w, stringify } = makeSyntheticWindow()
    const natives = findPatchedNatives(w, { stringify, clean: false })

    expect(natives.lies).toEqual([{ id: 'realm', kind: 'unverified_realm' }])
    expect(natives.patched).toEqual([])
  })

  it('catches callable ES6 Proxy around a native method via missing <expectedName> header AND invalid-receiver brand check', () => {
    const { w, stringify } = makeSyntheticWindow()
    // Wrap real V8 Date.prototype.getTimezoneOffset AND WebGL2 getParameter in ES6 Proxies:
    // V8 Function.prototype.toString.call(proxy) returns "function () { [native code] }"!
    const origGetParameter = w.WebGL2RenderingContext.prototype.getParameter
    w.WebGL2RenderingContext.prototype.getParameter = new Proxy(origGetParameter, {
      apply(target, thisArg, args) {
        if (args[0] === 0x9245) return 'Google Inc. (Spoofed)'
        return Reflect.apply(target, thisArg, args)
      },
    })

    const natives = findPatchedNatives(w, { stringify, clean: true })
    expect(natives.patched).toContain('WebGL2RenderingContext.prototype.getParameter')
    expect(natives.lies).toEqual(
      expect.arrayContaining([
        { id: 'WebGL2RenderingContext.prototype.getParameter', kind: 'not-native' },
        { id: 'WebGL2RenderingContext.prototype.getParameter', kind: 'brand' },
      ]),
    )
  })

  it('catches fn.bind(...) wrappers on both methods and prototype getters', () => {
    const { w, stringify } = makeSyntheticWindow()
    w.HTMLCanvasElement.prototype.getContext = (
      w.HTMLCanvasElement.prototype.getContext as (...args: unknown[]) => unknown
    ).bind(null) as typeof w.HTMLCanvasElement.prototype.getContext

    const origGetter = Object.getOwnPropertyDescriptor(w.Navigator.prototype, 'webdriver')!.get!
    Object.defineProperty(w.Navigator.prototype, 'webdriver', {
      get: origGetter.bind(w.navigator),
      configurable: true,
    })

    const natives = findPatchedNatives(w, { stringify, clean: true })
    const descriptors = findRedefinedProperties(w, stringify)

    expect(natives.patched).toContain('HTMLCanvasElement.prototype.getContext')
    expect(natives.lies).toContainEqual({
      id: 'HTMLCanvasElement.prototype.getContext',
      kind: 'not-native',
    })
    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'navigator.webdriver.getter', kind: 'descriptor' }),
        expect.objectContaining({ id: 'navigator.webdriver.getter', kind: 'brand' }),
      ]),
    )
  })

  it('records throwing Function.prototype.toString.call(fn) invocations as kind: "to-string-threw" (never silently skipping)', () => {
    const { w, nativeSources } = makeSyntheticWindow()
    const poisonedEstimate = () => Promise.resolve({ quota: 1, usage: 0 })
    ;(w.StorageManager.prototype as unknown as Record<string, unknown>).estimate = poisonedEstimate

    const poisonedPlatformGetter = () => 'Win32'
    Object.defineProperty(w.Navigator.prototype, 'platform', {
      get: poisonedPlatformGetter,
      configurable: true,
    })

    // Simulate a sabotaged toString that throws on tampered functions instead of
    // returning JS source text (which previously caused `if (!source) continue`).
    const throwingStringify = createRealmStringifier(function (this: unknown) {
      if (this === poisonedEstimate || this === poisonedPlatformGetter) {
        throw new TypeError('Function.prototype.toString requires that "this" be a Function')
      }
      if (nativeSources.has(this)) return nativeSources.get(this)!
      return INITIAL_FN_TO_STRING.call(this)
    })

    const natives = findPatchedNatives(w, { stringify: throwingStringify, clean: true })
    const descriptors = findRedefinedProperties(w, throwingStringify)

    expect(natives.patched).toContain('StorageManager.prototype.estimate')
    expect(natives.lies).toContainEqual({
      id: 'StorageManager.prototype.estimate',
      kind: 'to-string-threw',
    })
    expect(descriptors).toContainEqual({
      id: 'navigator.platform.getter',
      kind: 'to-string-threw',
    })
  })

  it('catches a Proxy getter on Navigator.prototype even if toString is forged to "function get userAgent() { [native code] }"', () => {
    const { w, stringify, nativeSources } = makeSyntheticWindow()
    const origGetter = Object.getOwnPropertyDescriptor(w.Navigator.prototype, 'userAgent')!.get!
    const spoofedProxy = new Proxy(origGetter, {
      apply() {
        return 'SpoofedUA/1.0'
      },
    })
    // Simulate a page where iframes were blocked (!clean) AND toString was forged:
    nativeSources.set(spoofedProxy, 'function get userAgent() { [native code] }')
    Object.defineProperty(w.Navigator.prototype, 'userAgent', {
      get: spoofedProxy,
      configurable: true,
    })

    const descriptors = findRedefinedProperties(w, stringify)
    expect(descriptors).toContainEqual({
      id: 'navigator.userAgent.getter',
      kind: 'brand',
      detail: 'getter-accepted-invalid-receiver',
    })
  })

  it('inspects expanded TARGETS including OfflineAudioContext.startRendering and HTMLElement offsetWidth/offsetHeight', () => {
    const { w, stringify } = makeSyntheticWindow()
    ;(w.OfflineAudioContext.prototype as unknown as Record<string, unknown>).startRendering = () =>
      Promise.resolve()
    Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', {
      get: () => 42,
      configurable: true,
    })

    const natives = findPatchedNatives(w, { stringify, clean: true })
    expect(natives.patched).toEqual(
      expect.arrayContaining([
        'OfflineAudioContext.prototype.startRendering',
        'HTMLElement.prototype.offsetWidth',
      ]),
    )
    expect(natives.lies).toEqual(
      expect.arrayContaining([
        { id: 'OfflineAudioContext.prototype.startRendering', kind: 'not-native' },
        { id: 'HTMLElement.prototype.offsetWidth', kind: 'not-native' },
        { id: 'HTMLElement.prototype.offsetWidth', kind: 'brand' },
      ]),
    )
  })
})
