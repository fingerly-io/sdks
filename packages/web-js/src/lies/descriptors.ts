/**
 * Properties that have been redefined.
 *
 * The usual way to spoof `navigator.webdriver` is not to patch a function but
 * to redefine a property - `Object.defineProperty(navigator, 'webdriver', {get:
 * () => false})`. That leaves two traces: the accessor is now an own property
 * of the instance rather than living on the prototype where the platform put
 * it, and its getter is no longer native.
 *
 * Neither trace can be removed without removing the spoof.
 */

import type { Lie } from '@fingerly/core'

import { attempt } from '../util.js'

const NATIVE_PATTERN = /\{\s*\[native code\]\s*\}\s*$/

/**
 * Properties the platform defines on a prototype, never on the instance.
 *
 * If one of these is an own property of `navigator` or `screen`, something put
 * it there. The list is limited to the ones spoofers actually target, because
 * every entry is a claim about where a browser puts a property and a wrong
 * claim is a false positive on every visitor.
 */
const INSTANCE_SHOULD_NOT_OWN: [holder: 'navigator' | 'screen', property: string][] = [
  ['navigator', 'webdriver'],
  ['navigator', 'userAgent'],
  ['navigator', 'platform'],
  ['navigator', 'plugins'],
  ['navigator', 'mimeTypes'],
  ['navigator', 'languages'],
  ['navigator', 'language'],
  ['navigator', 'hardwareConcurrency'],
  ['navigator', 'deviceMemory'],
  ['navigator', 'maxTouchPoints'],
  ['navigator', 'vendor'],
  ['navigator', 'appVersion'],
  ['navigator', 'productSub'],
  ['screen', 'width'],
  ['screen', 'height'],
  ['screen', 'availWidth'],
  ['screen', 'availHeight'],
  ['screen', 'colorDepth'],
]

export function findRedefinedProperties(w: Window & typeof globalThis): Lie[] {
  const lies: Lie[] = []

  for (const [holderName, property] of INSTANCE_SHOULD_NOT_OWN) {
    const holder = holderName === 'navigator' ? w.navigator : w.screen
    if (!holder) continue

    const own = attempt(() => Object.getOwnPropertyDescriptor(holder, property))

    if (own) {
      // The platform puts these on Navigator.prototype / Screen.prototype. An
      // own descriptor means the instance was written to directly.
      lies.push({
        id: `${holderName}.${property}`,
        kind: 'descriptor',
        detail: 'own-property-shadows-prototype',
      })
      continue
    }

    // Even on the prototype, the getter must still be native.
    const proto = attempt(() => Object.getPrototypeOf(holder) as object | null)
    if (!proto) continue

    const inherited = attempt(() => Object.getOwnPropertyDescriptor(proto, property))
    if (!inherited?.get) continue

    const source = attempt(() => Function.prototype.toString.call(inherited.get))
    if (source !== undefined && !NATIVE_PATTERN.test(source)) {
      lies.push({
        id: `${holderName}.${property}.getter`,
        kind: 'descriptor',
        detail: 'getter-is-not-native',
      })
    }
  }

  // The prototype chain itself. `navigator` must be a Navigator; a Proxy or a
  // hand-built stand-in is not, and several anti-detect browsers ship one.
  const navigatorProto = attempt(() => Object.getPrototypeOf(w.navigator))
  if (w.Navigator && navigatorProto !== undefined && navigatorProto !== w.Navigator.prototype) {
    lies.push({ id: 'navigator', kind: 'prototype', detail: 'not-Navigator.prototype' })
  }

  const screenProto = attempt(() => Object.getPrototypeOf(w.screen))
  if (w.Screen && screenProto !== undefined && screenProto !== w.Screen.prototype) {
    lies.push({ id: 'screen', kind: 'prototype', detail: 'not-Screen.prototype' })
  }

  return lies
}
