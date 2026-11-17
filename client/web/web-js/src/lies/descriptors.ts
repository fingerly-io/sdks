/**
 * Hardened property-descriptor, getter-header, prototype-chain, and WebIDL
 * receiver-brand inspection (`F-11`).
 */

import type { Lie } from '@fingerly/core'

import { attempt } from '../util.js'
import {
  createRealmStringifier,
  INITIAL_GET_OWN_PROP_DESC,
  INITIAL_GET_PROTOTYPE_OF,
  INITIAL_REFLECT_APPLY,
  isNativeFunctionSource,
  passesWebIdlBrandCheck,
  type RealmStringifier,
} from './natives.js'

const INSTANCE_SHOULD_NOT_OWN: readonly [holder: 'navigator' | 'screen', property: string][] = [
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
  ['screen', 'pixelDepth'],
  ['screen', 'orientation'],
]

const EMPTY_BRAND_ARGS: readonly (readonly unknown[])[] = [[]]

/** Two reads of one attribute agree. Objects are compared by content where cheap. */
function sameReading(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => Object.is(item, b[index]))
  }
  return false
}

/**
 * A wrapped `navigator` or `screen` (a `Proxy` returned by a replaced
 * `window.navigator` accessor, `WEB-04`) has no own properties and the right
 * prototype, so the descriptor checks pass. Two things still give it away:
 * the native getter refuses it as a receiver (`brand`), or the getter's answer
 * for the real object differs from what a plain read through the wrapper
 * returns (`contradiction`).
 */
function wrapperLies(
  holderName: 'navigator' | 'screen',
  holder: object,
  property: string,
  getter: (...args: unknown[]) => unknown,
  lies: Lie[],
): void {
  let viaGetter: unknown
  try {
    viaGetter = INITIAL_REFLECT_APPLY(getter, holder, [])
  } catch {
    if (!lies.some((lie) => lie.id === holderName && lie.kind === 'brand')) {
      lies.push({ id: holderName, kind: 'brand', detail: 'receiver-rejected' })
    }
    return
  }
  let viaRead: unknown
  try {
    viaRead = (holder as Record<string, unknown>)[property]
  } catch {
    lies.push({ id: `${holderName}.${property}`, kind: 'contradiction', detail: 'read-threw' })
    return
  }
  const comparable =
    (viaGetter === null || typeof viaGetter !== 'object' || Array.isArray(viaGetter)) &&
    (viaRead === null || typeof viaRead !== 'object' || Array.isArray(viaRead))
  if (comparable && !sameReading(viaGetter, viaRead)) {
    lies.push({ id: `${holderName}.${property}`, kind: 'contradiction', detail: 'read-differs-from-getter' })
  }
}

export interface DescriptorOptions {
  /**
   * Compare each getter's answer with a plain read (the wrapper check). Off in
   * the embedded WebView profile, where device values are not read at all.
   */
  readValues?: boolean
}

export function findRedefinedProperties(
  w: Window & typeof globalThis,
  stringify: RealmStringifier = createRealmStringifier(),
  options: DescriptorOptions = {},
): Lie[] {
  const readValues = options.readValues !== false
  const lies: Lie[] = []
  const holders = {
    navigator: attempt(() => w.navigator) as object | undefined,
    screen: attempt(() => w.screen) as object | undefined,
  }

  for (const [holderName, property] of INSTANCE_SHOULD_NOT_OWN) {
    const holder = holders[holderName]
    if (!holder) continue

    const own = attempt(() => INITIAL_GET_OWN_PROP_DESC(holder, property))
    if (own) {
      lies.push({
        id: `${holderName}.${property}`,
        kind: 'descriptor',
        detail: 'own-property-shadows-prototype',
      })
      continue
    }

    const proto = attempt(() => INITIAL_GET_PROTOTYPE_OF(holder) as object | null)
    if (!proto) continue

    const inherited = attempt(() => INITIAL_GET_OWN_PROP_DESC(proto, property))
    if (!inherited) continue

    const getterId = `${holderName}.${property}.getter`
    if ('value' in inherited && inherited.get === undefined) {
      lies.push({
        id: getterId,
        kind: 'descriptor',
        detail: 'data-property-replaces-getter',
      })
      continue
    }

    const getter = inherited.get
    if (typeof getter !== 'function') continue

    const stringified = stringify(getter)
    if (!stringified.ok) {
      lies.push({
        id: getterId,
        kind: 'to-string-threw',
      })
    } else if (!isNativeFunctionSource(getter, stringified.source, property, true)) {
      lies.push({
        id: getterId,
        kind: 'descriptor',
        detail: 'getter-is-not-native',
      })
    }

    if (!passesWebIdlBrandCheck(getter as (...args: unknown[]) => unknown, EMPTY_BRAND_ARGS)) {
      lies.push({
        id: getterId,
        kind: 'brand',
        detail: 'getter-accepted-invalid-receiver',
      })
    }

    if (readValues) {
      wrapperLies(holderName, holder, property, getter as (...args: unknown[]) => unknown, lies)
    }
  }

  // Read through `attempt`: a throwing `window.Navigator` getter is a finding,
  // not a reason to abort the whole inspection (`WEB-04`).
  const NavigatorCtor = attempt(() => w.Navigator)
  const navigatorProto = holders.navigator
    ? attempt(() => INITIAL_GET_PROTOTYPE_OF(holders.navigator))
    : undefined
  const navigatorPrototype = attempt(() => NavigatorCtor?.prototype)
  if (NavigatorCtor && navigatorProto !== undefined && navigatorProto !== navigatorPrototype) {
    lies.push({ id: 'navigator', kind: 'prototype', detail: 'not-Navigator.prototype' })
  }

  const ScreenCtor = attempt(() => w.Screen)
  const screenProto = holders.screen ? attempt(() => INITIAL_GET_PROTOTYPE_OF(holders.screen)) : undefined
  const screenPrototype = attempt(() => ScreenCtor?.prototype)
  if (ScreenCtor && screenProto !== undefined && screenProto !== screenPrototype) {
    lies.push({ id: 'screen', kind: 'prototype', detail: 'not-Screen.prototype' })
  }

  return lies
}
