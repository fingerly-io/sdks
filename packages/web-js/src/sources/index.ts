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
  hardwareSource,
  intlSource,
  mediaDevicesSource,
  networkSource,
  sensorsSource,
  touchSource,
} from './device.js'
import { mediaQueriesSource, screenSource } from './display.js'
import { domBlockersSource } from './dom.js'
import { engineSource, errorsSource, mathSource } from './engine.js'
import { navigatorSource, userAgentDataSource } from './navigator.js'
import { canvasSource, webglExtensionsSource, webglSource } from './render.js'
import { automationSource, permissionsSource, timingSource } from './runtime.js'
import { storageQuotaSource, storageSource } from './storage.js'
import { fontsSource } from './text.js'

export const browserSources: readonly Source[] = [
  // fast
  engineSource,
  errorsSource,
  mathSource,
  navigatorSource,
  screenSource,
  mediaQueriesSource,
  hardwareSource,
  touchSource,
  networkSource,
  intlSource,
  storageSource,
  storageQuotaSource,
  timingSource,
  permissionsSource,
  automationSource,

  // deferred
  canvasSource,
  webglSource,
  webglExtensionsSource,
  audioSource,
  audioLatencySource,
  fontsSource,
  sensorsSource,
  mediaDevicesSource,
  userAgentDataSource,
  domBlockersSource,
]

export * from './audio.js'
export * from './device.js'
export * from './display.js'
export * from './dom.js'
export * from './engine.js'
export * from './navigator.js'
export * from './render.js'
export * from './runtime.js'
export * from './storage.js'
export * from './text.js'
