/**
 * Hardened native-function & WebIDL receiver-brand tamper inspection (`F-11`).
 *
 * Captures `Function.prototype.toString`, `Object.getOwnPropertyDescriptor`,
 * `Object.getPrototypeOf`, and `Reflect.apply` at module initialization time.
 * That protects against a script that runs after the SDK loads and replaces
 * one of them. It gives no protection against a script that ran before: the
 * captured reference is then the replacement, and comparing the current value
 * with it compares the replacement with itself. Only the borrowed fresh realm
 * (`borrowRealmToString`) can see an earlier replacement, so that realm is
 * itself checked before it is trusted, and an unverified one is reported as
 * an `unverified_realm` lie.
 */

import type { Lie } from '@fingerly/core'

import { attempt } from '../util.js'

export const INITIAL_FN_TO_STRING = Function.prototype.toString
export const INITIAL_GET_OWN_PROP_DESC = Object.getOwnPropertyDescriptor
export const INITIAL_GET_PROTOTYPE_OF = Object.getPrototypeOf
export const INITIAL_REFLECT_APPLY = Reflect.apply

export type StringifyResult = { ok: true; source: string } | { ok: false }
export type RealmStringifier = (fn: unknown) => StringifyResult

export function createRealmStringifier(
  toStringFn: (this: unknown) => string = INITIAL_FN_TO_STRING,
): RealmStringifier {
  return (fn: unknown): StringifyResult => {
    try {
      const source = INITIAL_REFLECT_APPLY(toStringFn, fn, [])
      return typeof source === 'string' ? { ok: true, source } : { ok: false }
    } catch {
      return { ok: false }
    }
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Validates that `fn` is not a bound function (`!fn.name.startsWith('bound ')`)
 * AND its `Function.prototype.toString` output carries the exact native header
 * (`function <expectedName>()` or `function get <expectedName>()`), catching both
 * ES6 `new Proxy(nativeFn, { apply })` (`"function () { [native code] }"`) and
 * `nativeFn.bind(...)` (`"bound ..."` / `"function () { [native code] }"`).
 */
export function isNativeFunctionSource(
  fn: unknown,
  source: string,
  expectedName: string,
  isGetter = false,
): boolean {
  const fnName = attempt(() => (fn as { name?: unknown }).name)
  if (typeof fnName === 'string' && fnName.startsWith('bound ')) {
    return false
  }

  const escaped = escapeRegExp(expectedName)
  const pattern = isGetter
    ? new RegExp(`^\\s*function\\s+(?:get\\s+)?${escaped}\\s*\\(\\s*\\)\\s*\\{\\s*\\[native code\\]\\s*\\}\\s*$`)
    : new RegExp(`^\\s*function\\s+${escaped}\\s*\\(\\s*\\)\\s*\\{\\s*\\[native code\\]\\s*\\}\\s*$`)

  return pattern.test(source)
}

function isTypeErrorLike(error: unknown): boolean {
  if (error instanceof TypeError) return true
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'TypeError'
  )
}

/**
 * Synchronous WebIDL receiver brand check: invoking a synchronous WebIDL
 * prototype method or getter with a plain `{}` receiver must synchronously
 * throw `TypeError` (`Illegal invocation`). A `Proxy` `apply` trap that returns
 * a spoofed value without validating the receiver fails this check.
 */
export function passesWebIdlBrandCheck(
  fn: (...args: unknown[]) => unknown,
  argsList: readonly (readonly unknown[])[],
): boolean {
  for (const args of argsList) {
    let threwTypeError = false
    try {
      INITIAL_REFLECT_APPLY(fn, {}, [...args])
    } catch (error) {
      threwTypeError = isTypeErrorLike(error)
    }
    if (!threwTypeError) return false
  }
  return true
}

interface NativeTarget {
  readonly path: string
  readonly expectedName: string
  readonly isGetter?: boolean
  readonly brandArgsList?: readonly (readonly unknown[])[]
  readonly resolve: (w: Window & typeof globalThis) => unknown
}

function prototypeGetter(proto: object | undefined, prop: string): unknown {
  if (!proto) return undefined
  return attempt(() => INITIAL_GET_OWN_PROP_DESC(proto, prop)?.get)
}

/**
 * The getter (or, when it was replaced by a plain value, that value) of
 * `prop` on `holder` or its prototype chain. A [Replaceable] window attribute
 * such as `devicePixelRatio` becomes an own data property when a page assigns
 * to it; returning the value then makes the target report `not-native`.
 */
export function accessorOf(holder: unknown, prop: string): unknown {
  let current: unknown = holder
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth++) {
    const desc = attempt(() => INITIAL_GET_OWN_PROP_DESC(current as object, prop))
    if (desc) return desc.get ?? (('value' in desc) ? desc.value : undefined)
    current = attempt(() => INITIAL_GET_PROTOTYPE_OF(current as object))
  }
  return undefined
}

const GL_BRAND_ARGS: readonly (readonly unknown[])[] = [[0x1f00], [0x9245], [0x9246]]

/** The `Math` functions the `math` source calls. */
const MATH_FUNCTIONS = [
  'acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'cbrt', 'cos', 'cosh', 'exp',
  'expm1', 'log', 'log1p', 'pow', 'sin', 'sinh', 'sqrt', 'tan', 'tanh',
] as const

type AnyGlobal = Window & typeof globalThis & Record<string, unknown>

function member(w: Window & typeof globalThis, ctor: string, prop: string): unknown {
  const holder = (w as AnyGlobal)[ctor] as { prototype?: Record<string, unknown> } | undefined
  return holder?.prototype?.[prop]
}

const TARGETS: readonly NativeTarget[] = [
  // The primitives this layer itself depends on to borrow a fresh realm.
  {
    path: 'Document.prototype.createElement',
    expectedName: 'createElement',
    brandArgsList: [['div']],
    resolve: (w) => member(w, 'Document', 'createElement'),
  },
  {
    path: 'Node.prototype.appendChild',
    expectedName: 'appendChild',
    brandArgsList: [[]],
    resolve: (w) => member(w, 'Node', 'appendChild'),
  },
  {
    path: 'HTMLIFrameElement.prototype.contentWindow',
    expectedName: 'contentWindow',
    isGetter: true,
    brandArgsList: [[]],
    resolve: (w) =>
      prototypeGetter(
        ((w as AnyGlobal).HTMLIFrameElement as { prototype?: object } | undefined)?.prototype,
        'contentWindow',
      ),
  },
  // The window accessors every navigator and screen read goes through.
  {
    path: 'window.navigator',
    expectedName: 'navigator',
    isGetter: true,
    resolve: (w) => accessorOf(w, 'navigator'),
  },
  {
    path: 'window.screen',
    expectedName: 'screen',
    isGetter: true,
    resolve: (w) => accessorOf(w, 'screen'),
  },
  {
    path: 'window.devicePixelRatio',
    expectedName: 'devicePixelRatio',
    isGetter: true,
    resolve: (w) => accessorOf(w, 'devicePixelRatio'),
  },
  {
    path: 'window.matchMedia',
    expectedName: 'matchMedia',
    resolve: (w) => (w as AnyGlobal).matchMedia,
  },
  // What `worker_realm` builds its worker from (`WEB-03`).
  {
    path: 'Worker',
    expectedName: 'Worker',
    resolve: (w) => (w as AnyGlobal).Worker,
  },
  {
    path: 'Blob',
    expectedName: 'Blob',
    resolve: (w) => (w as AnyGlobal).Blob,
  },
  {
    path: 'URL.createObjectURL',
    expectedName: 'createObjectURL',
    resolve: (w) => ((w as AnyGlobal).URL as { createObjectURL?: unknown } | undefined)?.createObjectURL,
  },
  {
    path: 'OffscreenCanvas',
    expectedName: 'OffscreenCanvas',
    resolve: (w) => (w as AnyGlobal).OffscreenCanvas,
  },
  ...MATH_FUNCTIONS.map(
    (name): NativeTarget => ({
      path: `Math.${name}`,
      expectedName: name,
      resolve: () => (Math as unknown as Record<string, unknown>)[name],
    }),
  ),
  {
    path: 'Intl.DateTimeFormat.prototype.resolvedOptions',
    expectedName: 'resolvedOptions',
    brandArgsList: [[]],
    resolve: () => Intl?.DateTimeFormat?.prototype?.resolvedOptions,
  },
  {
    path: 'NavigatorUAData.prototype.getHighEntropyValues',
    expectedName: 'getHighEntropyValues',
    resolve: (w) => member(w, 'NavigatorUAData', 'getHighEntropyValues'),
  },
  {
    path: 'StorageManager.prototype.getDirectory',
    expectedName: 'getDirectory',
    resolve: (w) => member(w, 'StorageManager', 'getDirectory'),
  },
  {
    path: 'WebGLRenderingContext.prototype.getShaderPrecisionFormat',
    expectedName: 'getShaderPrecisionFormat',
    brandArgsList: [[0x8b31, 0x8df2]],
    resolve: (w) => member(w, 'WebGLRenderingContext', 'getShaderPrecisionFormat'),
  },
  {
    path: 'WebGLRenderingContext.prototype.getSupportedExtensions',
    expectedName: 'getSupportedExtensions',
    brandArgsList: [[]],
    resolve: (w) => member(w, 'WebGLRenderingContext', 'getSupportedExtensions'),
  },
  {
    path: 'Function.prototype.toString',
    expectedName: 'toString',
    resolve: () => Function.prototype.toString,
  },
  {
    path: 'Function.prototype.bind',
    expectedName: 'bind',
    resolve: () => Function.prototype.bind,
  },
  {
    path: 'Object.getOwnPropertyDescriptor',
    expectedName: 'getOwnPropertyDescriptor',
    resolve: () => Object.getOwnPropertyDescriptor,
  },
  {
    path: 'Object.defineProperty',
    expectedName: 'defineProperty',
    resolve: () => Object.defineProperty,
  },
  {
    path: 'Date.prototype.getTimezoneOffset',
    expectedName: 'getTimezoneOffset',
    resolve: () => Date.prototype.getTimezoneOffset,
  },
  {
    path: 'Number.prototype.toFixed',
    expectedName: 'toFixed',
    resolve: () => Number.prototype.toFixed,
  },
  {
    path: 'Error.prototype.toString',
    expectedName: 'toString',
    resolve: () => Error.prototype.toString,
  },
  {
    path: 'Intl.DateTimeFormat',
    expectedName: 'DateTimeFormat',
    resolve: () => Intl?.DateTimeFormat,
  },
  {
    path: 'Navigator.prototype.javaEnabled',
    expectedName: 'javaEnabled',
    resolve: (w) => w.Navigator?.prototype?.javaEnabled,
  },
  {
    path: 'Permissions.prototype.query',
    expectedName: 'query',
    resolve: (w) => w.Permissions?.prototype?.query,
  },
  {
    path: 'MediaDevices.prototype.enumerateDevices',
    expectedName: 'enumerateDevices',
    resolve: (w) => w.MediaDevices?.prototype?.enumerateDevices,
  },
  {
    path: 'HTMLCanvasElement.prototype.getContext',
    expectedName: 'getContext',
    brandArgsList: [['2d']],
    resolve: (w) => w.HTMLCanvasElement?.prototype?.getContext,
  },
  {
    path: 'HTMLCanvasElement.prototype.toDataURL',
    expectedName: 'toDataURL',
    resolve: (w) => w.HTMLCanvasElement?.prototype?.toDataURL,
  },
  {
    path: 'CanvasRenderingContext2D.prototype.getImageData',
    expectedName: 'getImageData',
    resolve: (w) => w.CanvasRenderingContext2D?.prototype?.getImageData,
  },
  {
    path: 'WebGLRenderingContext.prototype.getParameter',
    expectedName: 'getParameter',
    brandArgsList: GL_BRAND_ARGS,
    resolve: (w) => w.WebGLRenderingContext?.prototype?.getParameter,
  },
  {
    path: 'WebGLRenderingContext.prototype.getExtension',
    expectedName: 'getExtension',
    brandArgsList: [['WEBGL_lose_context']],
    resolve: (w) => w.WebGLRenderingContext?.prototype?.getExtension,
  },
  {
    path: 'WebGL2RenderingContext.prototype.getParameter',
    expectedName: 'getParameter',
    brandArgsList: GL_BRAND_ARGS,
    resolve: (w) =>
      (w as Window & typeof globalThis & { WebGL2RenderingContext?: { prototype?: { getParameter?: unknown } } })
        .WebGL2RenderingContext?.prototype?.getParameter,
  },
  {
    path: 'OfflineAudioContext.prototype.startRendering',
    expectedName: 'startRendering',
    resolve: (w) =>
      (w as Window & typeof globalThis & { OfflineAudioContext?: { prototype?: { startRendering?: unknown } } })
        .OfflineAudioContext?.prototype?.startRendering,
  },
  {
    path: 'AudioBuffer.prototype.getChannelData',
    expectedName: 'getChannelData',
    brandArgsList: [[0]],
    resolve: (w) => w.AudioBuffer?.prototype?.getChannelData,
  },
  {
    path: 'StorageManager.prototype.estimate',
    expectedName: 'estimate',
    resolve: (w) =>
      (w as Window & typeof globalThis & { StorageManager?: { prototype?: { estimate?: unknown } } })
        .StorageManager?.prototype?.estimate,
  },
  {
    path: 'Element.prototype.getBoundingClientRect',
    expectedName: 'getBoundingClientRect',
    resolve: (w) => w.Element?.prototype?.getBoundingClientRect,
  },
  {
    path: 'HTMLElement.prototype.offsetWidth',
    expectedName: 'offsetWidth',
    isGetter: true,
    brandArgsList: [[]],
    resolve: (w) => prototypeGetter(w.HTMLElement?.prototype, 'offsetWidth'),
  },
  {
    path: 'HTMLElement.prototype.offsetHeight',
    expectedName: 'offsetHeight',
    isGetter: true,
    brandArgsList: [[]],
    resolve: (w) => prototypeGetter(w.HTMLElement?.prototype, 'offsetHeight'),
  },
  {
    path: 'Performance.prototype.now',
    expectedName: 'now',
    resolve: (w) => w.Performance?.prototype?.now,
  },
  {
    path: 'Screen.prototype.constructor',
    expectedName: 'Screen',
    resolve: (w) => w.Screen,
  },
]

/**
 * Borrows `Function.prototype.toString` from a fresh same-origin sandboxed
 * `<iframe>` when allowed by the document and CSP, falling back to the
 * module-init `INITIAL_FN_TO_STRING` (`clean: false`) when blocked.
 */
export interface BorrowedRealm {
  stringify: RealmStringifier
  clean: boolean
  /**
   * Why the realm is not clean, when a check failed rather than the borrow
   * being impossible: `borrow-primitive-not-native`, `realm-not-distinct`,
   * `stringifier-implausible` or `inspection-threw`.
   */
  reason?: string
}

function unverified(reason?: string): BorrowedRealm {
  return {
    stringify: createRealmStringifier(INITIAL_FN_TO_STRING),
    clean: false,
    ...(reason === undefined ? {} : { reason }),
  }
}

/** A function whose own source text holds a marker no native function has. */
function fingerlyRealmProbe(): string {
  return 'fingerly-realm-probe-7c1e'
}

/**
 * Whether `fn` reads as the native `name` through the module-load stringifier.
 * Used for the borrow primitives themselves, before any fresh realm exists.
 */
function looksNative(fn: unknown, name: string, isGetter = false): boolean {
  if (typeof fn !== 'function') return false
  const source = attempt(() => INITIAL_REFLECT_APPLY(INITIAL_FN_TO_STRING, fn, []) as unknown)
  return typeof source === 'string' && isNativeFunctionSource(fn, source, name, isGetter)
}

/**
 * Whether `stringify` behaves like a genuine `Function.prototype.toString`: it
 * must reproduce a known non-native function's own source and describe itself
 * as native. A substitute that answers one constant string for everything,
 * which is what a replaced `contentWindow` can hand back, fails here.
 */
function plausibleStringifier(stringify: RealmStringifier, own: unknown): boolean {
  const probe = stringify(fingerlyRealmProbe)
  if (!probe.ok || !probe.source.includes('fingerly-realm-probe-7c1e')) return false
  if (probe.source.includes('[native code]')) return false
  const self = stringify(own)
  return self.ok && isNativeFunctionSource(own, self.source, 'toString', false)
}

/**
 * Borrows `Function.prototype.toString` from a fresh same-origin sandboxed
 * `<iframe>` when allowed by the document and CSP, falling back to the
 * module-init `INITIAL_FN_TO_STRING` (`clean: false`) when blocked.
 *
 * The borrow itself goes through `createElement`, `appendChild` and the
 * `contentWindow` getter, which an earlier script could have replaced
 * (`WEB-04`). Each is checked before use, the frame's window must be a realm
 * other than this one, and the borrowed stringifier must behave like a real
 * one. Any failed check leaves the realm unverified, which is reported.
 */
export function borrowRealmToString(): BorrowedRealm {
  try {
    return borrowRealm()
  } catch {
    return unverified('inspection-threw')
  }
}

function borrowRealm(): BorrowedRealm {
  if (typeof document === 'undefined') return unverified()
  const g = globalThis as AnyGlobal
  const doc = document

  const createElement = attempt(() => member(g, 'Document', 'createElement'))
  const appendChild = attempt(() => member(g, 'Node', 'appendChild'))
  const iframeProto = attempt(
    () => (g.HTMLIFrameElement as { prototype?: object } | undefined)?.prototype,
  )
  const contentWindowGetter = prototypeGetter(iframeProto, 'contentWindow')

  if (
    typeof createElement !== 'function' ||
    typeof appendChild !== 'function' ||
    typeof contentWindowGetter !== 'function'
  ) {
    return unverified()
  }
  if (
    !looksNative(createElement, 'createElement') ||
    !looksNative(appendChild, 'appendChild') ||
    !looksNative(contentWindowGetter, 'contentWindow', true)
  ) {
    return unverified('borrow-primitive-not-native')
  }

  const host = attempt(() => doc.body ?? doc.documentElement)
  if (!host) return unverified()

  const frame = attempt(() => {
    const element = INITIAL_REFLECT_APPLY(createElement, doc, ['iframe']) as HTMLIFrameElement
    element.setAttribute('sandbox', 'allow-same-origin')
    element.style.display = 'none'
    INITIAL_REFLECT_APPLY(appendChild, host, [element])
    return element
  })
  if (!frame) return unverified()

  try {
    const frameWindow = attempt(
      () => INITIAL_REFLECT_APPLY(contentWindowGetter, frame, []) as (Window & typeof globalThis) | null,
    )
    if (!frameWindow) return unverified()
    if ((frameWindow as unknown) === (globalThis as unknown)) return unverified('realm-not-distinct')

    const borrowed = attempt(() => frameWindow.Function?.prototype?.toString)
    if (typeof borrowed !== 'function') return unverified()
    if (borrowed === INITIAL_FN_TO_STRING) return unverified('realm-not-distinct')

    // Check the borrowed `toString` before detaching the frame, because some
    // DOM environments clear `contentWindow` intrinsics on removal.
    const candidate = createRealmStringifier(borrowed)
    if (!plausibleStringifier(candidate, borrowed)) return unverified('stringifier-implausible')
    attempt(() => frame.remove())
    if (!candidate(INITIAL_FN_TO_STRING).ok) return unverified()
    return { stringify: candidate, clean: true }
  } finally {
    attempt(() => frame.remove())
  }
}

export interface NativeReport {
  patched: string[]
  lies: Lie[]
  clean: boolean
  stringify: RealmStringifier
}

function markPatched(patched: string[], path: string): void {
  if (!patched.includes(path)) patched.push(path)
}

export function findPatchedNatives(
  w: Window & typeof globalThis,
  realm: BorrowedRealm = borrowRealmToString(),
): NativeReport {
  const patched: string[] = []
  const lies: Lie[] = []
  const { stringify, clean, reason } = realm

  if (!clean) {
    lies.push(
      reason === undefined
        ? { id: 'realm', kind: 'unverified_realm' }
        : { id: 'realm', kind: 'unverified_realm', detail: reason },
    )
  }

  for (const targetSpec of TARGETS) {
    const { path, expectedName, isGetter = false, brandArgsList, resolve } = targetSpec
    const target = attempt(() => resolve(w))

    if (target === undefined || target === null) {
      lies.push({ id: path, kind: 'missing' })
      continue
    }

    if (typeof target !== 'function') {
      markPatched(patched, path)
      lies.push({ id: path, kind: 'not-native' })
      continue
    }

    const stringified = stringify(target)
    if (!stringified.ok) {
      markPatched(patched, path)
      lies.push({ id: path, kind: 'to-string-threw' })
    } else if (!isNativeFunctionSource(target, stringified.source, expectedName, isGetter)) {
      markPatched(patched, path)
      lies.push({ id: path, kind: 'not-native' })
    }

    if (
      brandArgsList &&
      !passesWebIdlBrandCheck(target as (...args: unknown[]) => unknown, brandArgsList)
    ) {
      markPatched(patched, path)
      lies.push({ id: path, kind: 'brand' })
    }
  }

  // Self-check: if the page's current `Function.prototype.toString` was replaced
  // after module load or disagrees with the fresh realm's `toString`.
  const currentOwn = attempt(() => Function.prototype.toString)
  if (currentOwn !== INITIAL_FN_TO_STRING) {
    markPatched(patched, 'Function.prototype.toString')
    if (!lies.some((lie) => lie.id === 'Function.prototype.toString' && lie.kind !== 'missing')) {
      lies.push({
        id: 'Function.prototype.toString',
        kind: 'not-native',
        detail: 'replaced-after-init',
      })
    }
  } else if (clean && typeof currentOwn === 'function') {
    const viaBorrowed = stringify(currentOwn)
    if (!viaBorrowed.ok) {
      markPatched(patched, 'Function.prototype.toString')
      lies.push({
        id: 'Function.prototype.toString',
        kind: 'to-string-threw',
        detail: 'caught-via-fresh-realm',
      })
    } else if (!isNativeFunctionSource(currentOwn, viaBorrowed.source, 'toString', false)) {
      markPatched(patched, 'Function.prototype.toString')
      if (!lies.some((lie) => lie.id === 'Function.prototype.toString' && lie.kind === 'not-native')) {
        lies.push({
          id: 'Function.prototype.toString',
          kind: 'not-native',
          detail: 'caught-via-fresh-realm',
        })
      }
    }
  }

  return { patched, lies, clean, stringify }
}
