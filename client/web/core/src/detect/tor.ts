/**
 * Tor Browser detection.
 *
 * Tor Browser is Firefox with `privacy.resistFingerprinting` turned on and a
 * fixed set of defaults. That makes it, paradoxically, one of the most
 * identifiable browsers there is: every visitor is deliberately made to look
 * the same, and "identical to several million other people in a very specific
 * way" is itself a fingerprint.
 *
 * Almost none of these tells are the *absence* of a signal. They are the
 * presence of specific standardised values, which is why the collectors report
 * `blocked` with a reason rather than dropping a source - see the note on
 * [[BlockedSignal]]. Detecting anti-fingerprinting only to skip the affected
 * sources would throw the finding away.
 */

import {
  SOURCE,
  valueOf,
  wasBlocked,
  type CanvasSignal,
  type EngineSignal,
  type IntlSignal,
  type NavigatorSignal,
  type ScreenSignal,
  type TimingSignal,
} from '../signals.js'
import type { SignalReport, Verdict } from '../types.js'
import { weigh, type Evidence } from './verdict.js'

/**
 * `resistFingerprinting` clamps `performance.now()` to 100ms.
 *
 * No ordinary browser is anywhere near this: Chrome clamps to 5µs (100µs when
 * cross-origin isolated), Firefox without RFP to 1ms, Safari to 1ms. A
 * resolution at or above 100ms is therefore not a slow machine, it is a policy,
 * and it is the single strongest tell in this file.
 */
const RFP_CLOCK_RESOLUTION_MS = 100

/**
 * Tor letterboxes windows to multiples of 200x100 to collapse the entropy of
 * window size. A viewport that is an exact multiple of both is unusual enough
 * to be worth something, though not much alone - plenty of maximised windows
 * land on round numbers by chance.
 */
function isLetterboxed(width?: number, height?: number): boolean {
  if (typeof width !== 'number' || typeof height !== 'number') return false
  if (width <= 0 || height <= 0) return false
  return width % 200 === 0 && height % 100 === 0
}

export function detectTor(report: SignalReport): Verdict {
  const evidence: Evidence[] = []

  const timing = valueOf<TimingSignal>(report, SOURCE.timing)
  const intl = valueOf<IntlSignal>(report, SOURCE.intl)
  const screen = valueOf<ScreenSignal>(report, SOURCE.screen)
  const nav = valueOf<NavigatorSignal>(report, SOURCE.navigator)
  const canvas = valueOf<CanvasSignal>(report, SOURCE.canvas)
  const engine = valueOf<EngineSignal>(report, SOURCE.engine)

  // The clock clamp. Decisive.
  if (typeof timing?.now_resolution === 'number' && timing.now_resolution >= RFP_CLOCK_RESOLUTION_MS) {
    evidence.push({ reason: 'clock-resolution-clamped-to-100ms', weight: 1.6 })
  }

  // RFP forces UTC regardless of where the exit node is.
  if (intl?.timezone === 'UTC' && intl.timezone_offset === 0) {
    evidence.push({ reason: 'timezone-forced-to-utc', weight: 0.7 })
  }

  // And forces en-US, discarding the real locale.
  if (nav?.language === 'en-US' && nav.languages?.length === 1) {
    evidence.push({ reason: 'locale-forced-to-en-us', weight: 0.5 })
  }

  // RFP reports a fixed 2 cores. Real machines that genuinely have two exist,
  // so this is weighted as corroboration rather than as a finding.
  if (nav?.hardware_concurrency === 2) {
    evidence.push({ reason: 'hardware-concurrency-pinned-to-2', weight: 0.4 })
  }

  // Canvas readback is prompted or noised under RFP. Either the source came
  // back blocked, or it came back unstable - two reads of the same drawing
  // that disagree. Both mean the same thing here.
  if (wasBlocked(report, SOURCE.canvas) || canvas?.unstable === true) {
    evidence.push({ reason: 'canvas-readback-refused-or-noised', weight: 0.8 })
  }

  if (wasBlocked(report, SOURCE.audio)) {
    evidence.push({ reason: 'audio-readback-refused-or-noised', weight: 0.5 })
  }

  if (isLetterboxed(screen?.inner_width, screen?.inner_height)) {
    evidence.push({ reason: 'viewport-letterboxed-to-200x100-grid', weight: 0.5 })
  }

  // Tor ships a fixed bundled font set and blocks enumeration of the system's.
  if (wasBlocked(report, SOURCE.fonts)) {
    evidence.push({ reason: 'font-enumeration-restricted', weight: 0.5 })
  }

  // Everything above is Firefox-shaped by construction, because Tor Browser is
  // Firefox. Finding the same countermeasures on another engine means finding a
  // different hardened browser - Brave's aggressive mode, Mullvad, an anti-detect
  // build - which is worth reporting and is not worth calling Tor.
  //
  // Dampened rather than penalised. These tells add up to five or six points on
  // a genuine Tor Browser, so any fixed subtraction is outrun by the pile and
  // the verdict stays `high` regardless; scaling keeps the finding while moving
  // it out of the confidence band reserved for the real thing.
  const nonGecko = engine?.observed !== undefined && engine.observed !== 'gecko'
  if (nonGecko && evidence.length > 0) {
    evidence.push({ reason: 'rfp-tells-on-non-gecko-engine', weight: 0 })
  }

  return weigh(evidence, nonGecko ? 0.35 : 1)
}
