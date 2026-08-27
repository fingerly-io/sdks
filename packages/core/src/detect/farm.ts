/**
 * Device-farm detection - the client-observable half of it.
 *
 * A device farm is not a property of one device. It is N devices that are
 * suspiciously alike, arriving from one network inside one window, and no
 * amount of looking at a single browser can see that. The finding belongs to
 * the server, which has the other reports, the ASN and the velocity windows.
 *
 * What a page *can* contribute is whether this particular device looks
 * mass-provisioned: freshly imaged, stripped of the incidental state that
 * accumulates on a device someone actually uses. That is what this returns, and
 * it is named `farm` because it is the input to the server's farm rule - not
 * because a page can reach that conclusion on its own. A caller should treat a
 * true here as "worth correlating", never as "this is a farm".
 */

import {
  SOURCE,
  valueOf,
  type FontsSignal,
  type MediaDevicesSignal,
  type NavigatorSignal,
  type NetworkSignal,
  type ScreenSignal,
  type WebGLSignal,
} from '../signals.js'
import type { SignalReport, Verdict } from '../types.js'
import { unknown, weigh, type Evidence } from './verdict.js'

export function detectFarm(report: SignalReport): Verdict {
  const nav = valueOf<NavigatorSignal>(report, SOURCE.navigator)
  const fonts = valueOf<FontsSignal>(report, SOURCE.fonts)
  const devices = valueOf<MediaDevicesSignal>(report, SOURCE.mediaDevices)
  const webgl = valueOf<WebGLSignal>(report, SOURCE.webgl)
  const screen = valueOf<ScreenSignal>(report, SOURCE.screen)
  const network = valueOf<NetworkSignal>(report, SOURCE.network)

  if (!nav) return unknown()

  const evidence: Evidence[] = []

  // A font set with nothing but the platform defaults. Real devices accumulate
  // fonts - from an office suite, a design tool, a language pack - and a device
  // that has none was imaged and never used.
  if (fonts?.available && fonts.probed && fonts.probed > 20) {
    const ratio = fonts.available.length / fonts.probed
    if (ratio < 0.15) {
      evidence.push({ reason: 'font-set-is-platform-default-only', weight: 0.7 })
    }
  }

  // No media devices whatsoever. Every phone and almost every laptop has at
  // least a microphone; a rack of them frequently has none attached.
  if (
    devices &&
    devices.audio_input === 0 &&
    devices.video_input === 0 &&
    devices.audio_output === 0
  ) {
    evidence.push({ reason: 'no-media-devices-attached', weight: 0.8 })
  }

  // A GPU string with no model in it. Farms run virtualised or with generic
  // drivers far more often than consumer devices do.
  const renderer = webgl?.unmasked_renderer ?? webgl?.renderer
  if (renderer && /^(generic|google|unknown)\b/i.test(renderer)) {
    evidence.push({ reason: 'generic-gpu-renderer', weight: 0.5 })
  }

  // Cabled ethernet on a device claiming to be a phone. Phones are on cellular
  // or wifi; a phone farm is on a USB hub in a rack.
  if (network?.effective_type === '4g' && network.rtt === 0 && network.downlink === 10) {
    // These are the exact values Chrome reports when it cannot measure the
    // connection - which is what happens on a device with no real network
    // stack underneath it.
    evidence.push({ reason: 'synthetic-network-information', weight: 0.4 })
  }

  // Default locale on a device with a non-default screen. Provisioning scripts
  // set the screen and forget the locale.
  if (nav.languages?.length === 1 && nav.languages[0] === 'en-US' && screen?.device_pixel_ratio === 1) {
    evidence.push({ reason: 'untouched-locale-defaults', weight: 0.3 })
  }

  return weigh(evidence)
}
