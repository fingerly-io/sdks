/**
 * Emulator and virtual-device detection, from a browser.
 *
 * A native SDK can ask the operating system directly - `ro.kernel.qemu`, the
 * hypervisor bit, a sensor list. A page cannot, so everything here is indirect:
 * emulators render through software GPUs, report hardware combinations no real
 * device ships, and claim to be phones while behaving like desktops.
 *
 * The mobile SDKs will report `emulator` as a fact rather than a verdict. This
 * is the web approximation of it, and it is weighted accordingly.
 */

import {
  SOURCE,
  valueOf,
  type NavigatorSignal,
  type ScreenSignal,
  type SensorsSignal,
  type TouchSignal,
  type WebGLSignal,
} from '../signals.js'
import type { SignalReport, Verdict } from '../types.js'
import { unknown, weigh, type Evidence } from './verdict.js'

/**
 * Renderer strings that mean "no GPU is involved".
 *
 * SwiftShader and llvmpipe are software rasterisers - Chrome and Mesa's
 * respective fallbacks - and they are what an emulator, a headless container
 * and a VM without passthrough all end up using. The string is matched
 * case-insensitively on a substring because vendors decorate it differently
 * ("Google SwiftShader", "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device)").
 */
const SOFTWARE_RENDERERS = [
  'swiftshader',
  'llvmpipe',
  'softpipe',
  'mesa offscreen',
  'android emulator',
  'generic renderer',
  'apple software renderer',
  'microsoft basic render',
  'virgl',
  'vmware svga',
  'virtualbox',
  'parallels',
]

function isSoftwareRenderer(renderer?: string): string | undefined {
  if (!renderer) return undefined
  const haystack = renderer.toLowerCase()
  return SOFTWARE_RENDERERS.find((needle) => haystack.includes(needle))
}

/** A user-agent claiming a phone or tablet. Claimed, so only a gate. */
function claimsMobile(userAgent?: string): boolean {
  if (!userAgent) return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
}

export function detectEmulator(report: SignalReport): Verdict {
  const webgl = valueOf<WebGLSignal>(report, SOURCE.webgl)
  const nav = valueOf<NavigatorSignal>(report, SOURCE.navigator)
  const screen = valueOf<ScreenSignal>(report, SOURCE.screen)
  const touch = valueOf<TouchSignal>(report, SOURCE.touch)
  const sensors = valueOf<SensorsSignal>(report, SOURCE.sensors)

  if (!webgl && !nav) return unknown()

  const evidence: Evidence[] = []
  const mobile = claimsMobile(nav?.user_agent)

  const software = isSoftwareRenderer(webgl?.unmasked_renderer ?? webgl?.renderer)
  if (software) {
    // On a device claiming to be a phone this is close to conclusive: every
    // shipping phone has a GPU, and no shipping phone falls back to llvmpipe.
    // On desktop it is much weaker - a VM, a remote desktop session and a
    // machine with a broken driver all land here legitimately.
    evidence.push({
      reason: `software-renderer-${software.replace(/\s+/g, '-')}`,
      weight: mobile ? 1.5 : 0.7,
    })
  }

  // A phone that says it has no touch points. Emulators driven by a mouse
  // frequently forget to set this.
  if (mobile && touch?.max_touch_points === 0) {
    evidence.push({ reason: 'mobile-ua-without-touch-points', weight: 0.9 })
  }

  // A phone whose pointer is fine and which supports hover. Both are desktop
  // input characteristics, and `matchMedia` is answered by the compositor
  // rather than by anything a user-agent override touches.
  if (mobile && touch?.pointer_coarse === false && touch.any_hover === true) {
    evidence.push({ reason: 'mobile-ua-with-fine-pointer-and-hover', weight: 0.9 })
  }

  // A phone with no motion sensors at all. Real ones have both.
  if (mobile && sensors?.device_motion === false && sensors.device_orientation === false) {
    evidence.push({ reason: 'mobile-ua-without-motion-sensors', weight: 0.7 })
  }

  // A device pixel ratio of exactly 1 on a phone. Every shipping phone since
  // roughly 2013 is 2 or 3; an emulator window defaults to 1 unless told
  // otherwise.
  if (mobile && screen?.device_pixel_ratio === 1) {
    evidence.push({ reason: 'mobile-ua-with-dpr-1', weight: 0.6 })
  }

  // Hardware combinations that no shipping device has. A machine reporting a
  // single core is either very old, throttled by RFP - which the Tor detector
  // handles - or synthetic.
  if (typeof nav?.hardware_concurrency === 'number' && nav.hardware_concurrency === 1) {
    evidence.push({ reason: 'single-core-reported', weight: 0.4 })
  }

  // Screen dimensions that are exact emulator window defaults, on a mobile UA.
  // Weak on its own; a real device occasionally matches.
  if (mobile && screen?.width === 1080 && screen.height === 1920 && screen.device_pixel_ratio === 1) {
    evidence.push({ reason: 'emulator-default-screen-geometry', weight: 0.5 })
  }

  return weigh(evidence)
}
