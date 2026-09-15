/**
 * The browser source set.
 *
 * Order within a tier does not matter - the scheduler runs them concurrently up
 * to its cap - but the tier does. `fast` sources are cheap reads that a page
 * can afford to block a click on; `deferred` sources render, measure layout or
 * await hardware, and are worth having only because the budget bounds them.
 */

import type { Source } from '@badele/core'

import { audioLatencySource, audioSource } from './audio.js'
import {
  batterySource,
  hardwareSource,
  intlSource,
  mediaDevicesSource,
  networkSource,
  sensorsSource,
  speechSource,
  touchSource,
  timezoneSource,
} from './device.js'
import { colorGamutSource, mediaQueriesSource, screenFrameSource, screenSource } from './display.js'
import { storageDurabilitySource } from './durability.js'
import { domBlockersSource } from './dom.js'
import { engineSource, errorsSource, mathSource } from './engine.js'
import {
  languagesSource,
  navigatorSource,
  pluginsSource,
  userAgentDataSource,
  vendorSource,
} from './navigator.js'
import { canvasSource, webglExtensionsSource, webglSource } from './render.js'
import { automationSource, permissionsSource, timingSource } from './runtime.js'
import { shieldsSource } from './shields.js'
import { storageQuotaSource, storageSource } from './storage.js'
import { fontPreferencesSource, fontsSource } from './text.js'

export const browserSources: readonly Source[] = [
  // fast
  engineSource,
  errorsSource,
  mathSource,
  navigatorSource,
  languagesSource,
  pluginsSource,
  vendorSource,
  screenSource,
  screenFrameSource,
  mediaQueriesSource,
  colorGamutSource,
  hardwareSource,
  touchSource,
  networkSource,
  intlSource,
  timezoneSource,
  storageSource,
  storageQuotaSource,
  shieldsSource,
  timingSource,
  permissionsSource,
  automationSource,
  webglSource,

  // deferred
  canvasSource,
  webglExtensionsSource,
  audioSource,
  audioLatencySource,
  fontsSource,
  fontPreferencesSource,
  batterySource,
  speechSource,
  sensorsSource,
  mediaDevicesSource,
  userAgentDataSource,
  domBlockersSource,
  storageDurabilitySource,
]

export * from './audio.js'
export * from './device.js'
export * from './display.js'
export * from './dom.js'
export * from './durability.js'
export * from './engine.js'
export * from './navigator.js'
export * from './render.js'
export * from './runtime.js'
export * from './shields.js'
export * from './storage.js'
export * from './text.js'
