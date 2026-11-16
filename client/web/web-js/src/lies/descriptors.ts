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
]

const EMPTY_BRAND_ARGS: readonly (readonly unknown[])[] = [[]]

export function findRedefinedProperties(
  w: Window & typeof globalThis,
  stringify: RealmStringifier = createRealmStringifier(),
): Lie[] {
  const lies: Lie[] = []

  for (const [holderName, property] of INSTANCE_SHOULD_NOT_OWN) {
    const holder = holderName === 'navigator' ? w.navigator : w.screen
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
  }

  const navigatorProto = attempt(() => INITIAL_GET_PROTOTYPE_OF(w.navigator))
  if (w.Navigator && navigatorProto !== undefined && navigatorProto !== w.Navigator.prototype) {
    lies.push({ id: 'navigator', kind: 'prototype', detail: 'not-Navigator.prototype' })
  }

  const screenProto = attempt(() => INITIAL_GET_PROTOTYPE_OF(w.screen))
  if (w.Screen && screenProto !== undefined && screenProto !== w.Screen.prototype) {
    lies.push({ id: 'screen', kind: 'prototype', detail: 'not-Screen.prototype' })
  }

  return lies
}
