/**
 * The single-pass two-stage browser source set (`prerequisite` -> `collect`).
 */

import { EMBEDDED_SAFE_SOURCES, own, UnsupportedSignal, type Source } from '@fingerly/core'

import { detectEmbedding } from '../embedding.js'

import { audioLatencySource, audioSource } from './audio.js'
import {
  hardwareSource,
  intlSource,
  mediaDevicesSource,
  networkSource,
  timezoneSource,
  touchSource,
} from './device.js'
import { colorGamutSource, mediaQueriesSource, screenFrameSource, screenSource } from './display.js'
import { storageDurabilitySource } from './durability.js'
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
import { workerRealmSource } from './worker_realm.js'

/**
 * Guards direct `browserSources` callers inside detected embedded WebViews so
 * device-fingerprinting collectors refuse with `UnsupportedSignal('embedded')`,
 * while DPLA-safe non-identifying runtime/integrity sources (`F-01`) remain
 * permitted.
 */
function guarded(source: Source): Source {
  // Own property only (`WEB-09`): a polluted `embeddedSafe` must not let a
  // fingerprinting source run inside an app.
  const safeInEmbedded = own(source, 'embeddedSafe') === true || EMBEDDED_SAFE_SOURCES.has(source.id)
  return {
    ...source,
    run: (ctx) => {
      if (!safeInEmbedded && detectEmbedding()) throw new UnsupportedSignal('embedded')
      return source.run(ctx)
    },
  }
}

const allBrowserSources: readonly Source[] = [
  // Stage 1: prerequisite barrier (completes before shields & canvas run)
  engineSource,
  timingSource,

  // Stage 2: single-pass collect
  errorsSource,
  mathSource,
  navigatorSource,
  languagesSource,
  pluginsSource,
  vendorSource,
  userAgentDataSource,
  workerRealmSource,
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
  storageDurabilitySource,
  shieldsSource,
  permissionsSource,
  automationSource,
  webglSource,
  webglExtensionsSource,
  mediaDevicesSource,
  canvasSource,
  audioSource,
  audioLatencySource,
  fontsSource,
  fontPreferencesSource,
]

export const browserSources: readonly Source[] = allBrowserSources.map(guarded)

export * from './audio.js'
export * from './device.js'
export * from './display.js'
export * from './durability.js'
export * from './engine.js'
export * from './navigator.js'
export * from './render.js'
export * from './runtime.js'
export * from './shields.js'
export * from './storage.js'
export * from './text.js'
export * from './worker_realm.js'
