/**
 * The single-pass two-stage browser source set (`prerequisite` -> `collect`).
 */

import { EMBEDDED_SAFE_SOURCES, own, UnsupportedSignal, type Source } from '@fingerly/core'

import { detectEmbedding } from '../embedding.js'

import { audioLatencySource, audioSource } from './audio.js'
import {
  applePaySource,
  codecsSource,
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
import { interactionSource } from './interaction.js'
import {
  languagesSource,
  navigatorSource,
  userAgentDataSource,
  vendorSource,
} from './navigator.js'
import {
  canvasSource,
  webgl2Source,
  webglExtensionsSource,
  webglSource,
  webgpuSource,
} from './render.js'
import { automationSource, permissionsSource, timingSource } from './runtime.js'
import { shieldsSource } from './shields.js'
import { storageQuotaSource, storageSource } from './storage.js'
import { fontPreferencesSource, fontsSource, voicesSource } from './text.js'
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
  // Stage 1: prerequisite barrier (completes before shields, canvas & webgl run)
  engineSource,
  timingSource,

  // Stage 2: single-pass collect.
  // 1. Instantaneous synchronous critical getters (< 2ms total) run first so a
  //    cold GPU process or 90-font layout pass can never starve them.
  errorsSource,
  mathSource,
  navigatorSource,
  languagesSource,
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
  storageQuotaSource,
  automationSource,
  applePaySource,
  // Opt-in (`agentDetection: 'interaction'`): hands over what the observer
  // started at consent has counted, so it costs nothing here.
  interactionSource,

  // 2. Five async IPC critical sources dispatch background browser work across
  //    5 of the 6 worker slots and yield immediately, leaving slot 6 free.
  userAgentDataSource,
  shieldsSource,
  storageSource,
  codecsSource,
  audioSource,

  // 3. CPU 2D canvas (`willReadFrequently: true`) & DOM layout critical sources
  //    finish in a few ms before WebGL initializes a cold GPU process.
  canvasSource,
  fontsSource,
  fontPreferencesSource,
  webglSource,
  webgl2Source,

  // 4. Remaining async critical sources (picked up as soon as a worker frees).
  voicesSource,
  storageDurabilitySource,

  // 5. Remaining non-critical sources.
  webglExtensionsSource,
  permissionsSource,
  webgpuSource,
  mediaDevicesSource,
  audioLatencySource,
  workerRealmSource,
]

export const browserSources: readonly Source[] = allBrowserSources.map(guarded)

export * from './audio.js'
export * from './device.js'
export * from './display.js'
export * from './durability.js'
export * from './engine.js'
export * from './interaction.js'
export * from './navigator.js'
export * from './render.js'
export * from './runtime.js'
export * from './shields.js'
export * from './storage.js'
export * from './text.js'
export * from './worker_realm.js'
