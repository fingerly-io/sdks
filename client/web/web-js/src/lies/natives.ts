/**
 * Hardened native-function & WebIDL receiver-brand tamper inspection (`F-11`).
 *
 * Captures `Function.prototype.toString`, `Object.getOwnPropertyDescriptor`,
 * `Object.getPrototypeOf`, and `Reflect.apply` at module initialization time so
 * late page-injected scripts cannot blind the inspector.
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

const GL_BRAND_ARGS: readonly (readonly unknown[])[] = [[0x1f00], [0x9245], [0x9246]]

const TARGETS: readonly NativeTarget[] = [
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
export function borrowRealmToString(): {
  stringify: RealmStringifier
  clean: boolean
} {
  if (typeof document === 'undefined') {
    return { stringify: createRealmStringifier(INITIAL_FN_TO_STRING), clean: false }
  }
  const host = document.body ?? document.documentElement
  if (!host || typeof document.createElement !== 'function') {
    return { stringify: createRealmStringifier(INITIAL_FN_TO_STRING), clean: false }
  }

  const frame = attempt(() => {
    const element = document.createElement('iframe')
    element.setAttribute('sandbox', 'allow-same-origin')
    element.style.display = 'none'
    host.appendChild(element)
    return element
  })

  if (!frame) {
    return { stringify: createRealmStringifier(INITIAL_FN_TO_STRING), clean: false }
  }

  try {
    const borrowed = attempt(
      () =>
        (frame.contentWindow as (Window & typeof globalThis) | null)?.Function?.prototype?.toString,
    )
    if (typeof borrowed === 'function') {
      // Verify the borrowed `toString` works before detaching the frame, because
      // some DOM environments clear `contentWindow` intrinsics on removal; if it
      // stops working after removal we keep a pre-bound snapshot check below.
      const candidate = createRealmStringifier(borrowed)
      frame.remove()
      const probe = candidate(INITIAL_FN_TO_STRING)
      if (probe.ok) {
        return { stringify: candidate, clean: true }
      }
    }
    return { stringify: createRealmStringifier(INITIAL_FN_TO_STRING), clean: false }
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
  realm = borrowRealmToString(),
): NativeReport {
  const patched: string[] = []
  const lies: Lie[] = []
  const { stringify, clean } = realm

  if (!clean) {
    lies.push({ id: 'realm', kind: 'unverified_realm' })
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
