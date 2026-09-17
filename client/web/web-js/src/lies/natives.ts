/**
 * Finding the builtins that are no longer builtin.
 *
 * A patched native does not stringify to `[native code]`. That is a one-line
 * check, and another library has it - `isFunctionNative` - and calls it exactly
 * once, on `window.print`, to work out whether a PDF viewer is installed. The
 * primitive that catches every stealth plugin and anti-detect browser is sitting
 * unused in the library.
 *
 * This file points it at everything worth pointing it at.
 *
 * # The obvious counter-attack
 *
 * A sufficiently careful spoofer patches `Function.prototype.toString` itself,
 * so that every patched function claims to be native. That is handled in two
 * ways: `toString` is checked against itself, and where the browser allows it,
 * a *fresh realm* is borrowed from a same-origin iframe. An iframe gets its own
 * set of intrinsics, so a page-level patch does not reach it, and comparing the
 * two realms' answers finds a spoofer who only patched the one they could see.
 */

import type { Lie } from '@fingerly/core'

import { attempt } from '../util.js'

const NATIVE_PATTERN = /\{\s*\[native code\]\s*\}\s*$/

/**
 * The paths checked, as `object.property` names for the report.
 *
 * The resolver takes `Window & typeof globalThis` rather than `Window`: the
 * interface constructors - `Navigator`, `WebGLRenderingContext` and the rest -
 * are declared as globals, not as members of the `Window` interface, so they
 * are only reachable through the global type.
 */
const TARGETS: [path: string, resolve: (w: Window & typeof globalThis) => unknown][] = [
  ['Function.prototype.toString', () => Function.prototype.toString],
  ['Function.prototype.bind', () => Function.prototype.bind],
  ['Object.getOwnPropertyDescriptor', () => Object.getOwnPropertyDescriptor],
  ['Object.defineProperty', () => Object.defineProperty],
  ['Date.prototype.getTimezoneOffset', () => Date.prototype.getTimezoneOffset],
  ['Number.prototype.toFixed', () => Number.prototype.toFixed],
  ['Error.prototype.toString', () => Error.prototype.toString],
  ['Intl.DateTimeFormat', () => Intl?.DateTimeFormat],
  ['Navigator.prototype.javaEnabled', (w) => w.Navigator?.prototype?.javaEnabled],
  ['Permissions.prototype.query', (w) => w.Permissions?.prototype?.query],
  ['MediaDevices.prototype.enumerateDevices', (w) => w.MediaDevices?.prototype?.enumerateDevices],
  ['HTMLCanvasElement.prototype.toDataURL', (w) => w.HTMLCanvasElement?.prototype?.toDataURL],
  [
    'CanvasRenderingContext2D.prototype.getImageData',
    (w) => w.CanvasRenderingContext2D?.prototype?.getImageData,
  ],
  [
    'WebGLRenderingContext.prototype.getParameter',
    (w) => w.WebGLRenderingContext?.prototype?.getParameter,
  ],
  [
    'WebGLRenderingContext.prototype.getExtension',
    (w) => w.WebGLRenderingContext?.prototype?.getExtension,
  ],
  ['AudioBuffer.prototype.getChannelData', (w) => w.AudioBuffer?.prototype?.getChannelData],
  ['Element.prototype.getBoundingClientRect', (w) => w.Element?.prototype?.getBoundingClientRect],
  ['Performance.prototype.now', (w) => w.Performance?.prototype?.now],
  ['Screen.prototype.constructor', (w) => w.Screen],
]

/**
 * Borrow `Function.prototype.toString` from a fresh realm.
 *
 * A same-origin iframe has its own intrinsics, untouched by anything the page
 * did to its own. Where one can be created, its `toString` is the honest one.
 * Where it cannot - a sandbox, a CSP that forbids frames, a detached document -
 * the page's own is used, and the check degrades rather than failing.
 */
function borrowToString(): { fn: (this: unknown) => string; clean: boolean } {
  const own = Function.prototype.toString

  if (typeof document === 'undefined' || !document.body) return { fn: own, clean: false }

  const frame = attempt(() => {
    const element = document.createElement('iframe')
    element.setAttribute('sandbox', 'allow-same-origin')
    element.style.display = 'none'
    document.body.appendChild(element)
    return element
  })

  if (!frame) return { fn: own, clean: false }

  try {
    const borrowed = attempt(
      () =>
        (frame.contentWindow as (Window & typeof globalThis) | null)?.Function?.prototype?.toString,
    )
    return borrowed ? { fn: borrowed, clean: true } : { fn: own, clean: false }
  } finally {
    frame.remove()
  }
}

export interface NativeReport {
  patched: string[]
  lies: Lie[]
}

export function findPatchedNatives(w: Window & typeof globalThis): NativeReport {
  const patched: string[] = []
  const lies: Lie[] = []

  const { fn: toString, clean } = borrowToString()

  const stringify = (value: unknown): string | undefined =>
    attempt(() => toString.call(value))

  for (const [path, resolve] of TARGETS) {
    const target = attempt(() => resolve(w))

    if (target === undefined || target === null) {
      // Absent rather than patched. Recorded separately: a missing
      // `WebGLRenderingContext` is an ordinary browser without WebGL, and
      // calling that tampering would fire on every locked-down device.
      lies.push({ id: path, kind: 'missing' })
      continue
    }

    if (typeof target !== 'function') continue

    const source = stringify(target)
    if (source === undefined) continue

    if (!NATIVE_PATTERN.test(source)) {
      patched.push(path)
      lies.push({ id: path, kind: 'not-native' })
    }
  }

  // The self-check. If the page's own `toString` disagrees with the borrowed
  // one about the page's own `toString`, the page's copy has been replaced -
  // which is the specific move a stealth plugin makes to hide everything else.
  if (clean) {
    const own = Function.prototype.toString
    const viaBorrowed = stringify(own)
    if (viaBorrowed !== undefined && !NATIVE_PATTERN.test(viaBorrowed)) {
      if (!patched.includes('Function.prototype.toString')) {
        patched.push('Function.prototype.toString')
      }
      lies.push({
        id: 'Function.prototype.toString',
        kind: 'not-native',
        detail: 'caught-via-fresh-realm',
      })
    }
  }

  return { patched, lies }
}
