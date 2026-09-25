/**
 * Anti-fingerprinting countermeasures, and which signals they invalidate.
 *
 * This detector is the odd one out in this folder. The others answer "is this
 * visitor something" - a bot, a private window, an emulator - and a customer
 * acts on the answer. This one answers "which of the numbers below are made
 * up", and its consumers are the other detectors and the identity hash. Nobody
 * should ever be challenged for what it finds. Running Brave is evidence of
 * running Brave.
 *
 * It exists because the alternative was discovered the hard way. Brave pins
 * `navigator.storage.estimate().quota` to exactly 2 GiB in every window, and
 * draws `navigator.deviceMemory` from {2, 4, 8, 16, 32} per site and session.
 * `detect/incognito` divided the first by the second and compared against a
 * ceiling, so every Brave visitor on the web was reported to be in a private
 * window, from an ordinary one, with a reason that read perfectly plausibly.
 * A gate that fires on a farbled value is not a detector, it is a coin flip
 * with a citation.
 *
 * The tells are ordered by what it takes to remove them: a build with the
 * vendor API stripped and the brand hidden still has to choose between
 * reporting a real quota and keeping the protection the constant provides.
 */

import {
  SOURCE,
  statusOf,
  valueOf,
  type CanvasSignal,
  type EngineSignal,
  type HardwareSignal,
  type NavigatorSignal,
  type ShieldsSignal,
  type SourceId,
  type StorageSignal,
} from '../signals.js'
import type { SignalReport, Verdict } from '../types.js'
import { weigh, type Evidence } from './verdict.js'

/**
 * The number Brave returns instead of a storage estimate.
 *
 * Hard-coded in `v8_storage_estimate.h`, applied to every window on every
 * machine, and - unlike the rest of Brave's farbling - not gated on the
 * shields level, so it is there even for a visitor who turned the protection
 * off for this site. That makes it the most reliable tell in the file and, for
 * the same reason, the one that renders `StorageSignal.quota` worthless.
 */
export const BRAVE_SYNTHETIC_QUOTA = 2_147_483_648

/**
 * The quota Chromium now reports instead of measuring one, and the reason the
 * private-window rules had to be rewritten around it.
 *
 * `QuotaManagerImpl::CalculateReportedQuota` returns `usage + 10 GiB` from any
 * device with at least 10 GiB of disk, and - since `kIncognitoStaticStorageQuota`,
 * on by default - from an incognito profile regardless of the disk. Chromium's
 * own comment on the flag says what it is for: "Incognito mode will always
 * report a maximal quota value to avoid fingerprinting and incognito detection."
 *
 * Two consequences, and the second is the one that bites:
 *
 *  1. On a current Chromium the quota is the same number in both windows, so
 *     it detects nothing. Measured on Chrome 152: 10737418240 in an ordinary
 *     window and 10737418240 in an incognito one, on the same machine.
 *  2. Below that ceiling the meaning is *inverted*. A device with less than
 *     10 GiB of disk gets its disk size rounded up instead - in an ordinary
 *     window only, because the incognito path is pinned. So on a current build
 *     a small quota is evidence of an ordinary window, and the old rule read it
 *     as the opposite.
 *
 * Which is why every reader compares against this constant before doing
 * anything else, rather than treating a small number as inherently suspicious.
 */
export const CHROMIUM_STATIC_QUOTA = 10_737_418_240 // 10 GiB

/**
 * Whether a quota reading is Chromium's constant rather than a measurement.
 *
 * The usage has to come off first: the reported figure is `usage + 10 GiB`, so
 * an origin that has stored something reports more than the constant and a
 * plain equality test would miss it.
 */
export function isStaticChromiumQuota(quota: number, usage: number | undefined): boolean {
  return quota - (usage ?? 0) === CHROMIUM_STATIC_QUOTA
}

/**
 * How many entries `navigator.plugins` is allowed to have.
 *
 * Since plugins stopped being real the list has been a fiction with a fixed
 * cast: HTML specifies the PDF viewer under exactly five names, and a browser
 * either reports all five or reports none. Brave appends two more, with names
 * assembled from a word list and seeded per session, so a Chromium reporting
 * seven has had its list padded by something.
 *
 * Worth more than it looks. Brave pads only when farbling is switched on for
 * the origin, which makes this the one probe here that says whether the
 * protection is actually *running* rather than merely compiled in - the quota
 * constant is present either way.
 */
const CHROMIUM_PLUGIN_COUNT = 5

/**
 * Why there is no `deviceMemory` tell here, and why that is not an oversight.
 *
 * The obvious one is wrong. Chromium's `ApproximatedDeviceMemory` clamps to
 * [2, 32] on desktop and only to [1, 8] on Android, so an ordinary desktop
 * Chrome on a 16GB machine reports 16 - and Brave's replacement set,
 * {2, 4, 8, 16, 32}, is precisely the set of values a desktop Chromium can
 * legitimately produce. Brave chose it that way.
 *
 * So there is nothing to catch: the farbled 16 and the honest 16 are the same
 * number, and a rule that called 16 impossible would have fired on every
 * ordinary Chrome with more than 12GB of memory. That is the same bug this
 * file exists to fix, introduced from the other side, and it was one commit
 * away from shipping. The field is instead handled by refusing to divide by it
 * whenever anything else says the browser farbles - see [[trustedDeviceMemory]].
 */

export function detectShields(report: SignalReport): Verdict {
  const shields = valueOf<ShieldsSignal>(report, SOURCE.shields)
  const storage = valueOf<StorageSignal>(report, SOURCE.storage)
  const nav = valueOf<NavigatorSignal>(report, SOURCE.navigator)
  const engine = valueOf<EngineSignal>(report, SOURCE.engine)
  const canvas = valueOf<CanvasSignal>(report, SOURCE.canvas)

  const evidence: Evidence[] = []
  const chromium = engine?.observed === 'chromium'

  // The browser's own answer. One line to remove, and worth a lot while it is
  // there, which is the definition of a signal that must not stand alone.
  if (shields?.brave === true) {
    evidence.push({ reason: 'brave-vendor-api', weight: 0.9 })
  }

  if (shields?.brave_claimed === true) {
    evidence.push({ reason: 'brave-named-in-ua-ch-brands', weight: 0.5 })
  }

  // Behavioural, and the two that survive a build with the name taken out.
  if (chromium && storage?.quota === BRAVE_SYNTHETIC_QUOTA) {
    evidence.push({ reason: 'storage-quota-is-brave-constant', weight: 1.0 })
  }

  // A padded plugin list, which no spec-compliant browser produces and which
  // additionally means the farbling is switched on for this origin.
  if (
    chromium &&
    typeof nav?.plugin_count === 'number' &&
    nav.plugin_count > CHROMIUM_PLUGIN_COUNT
  ) {
    evidence.push({ reason: 'plugin-list-padded', weight: 0.8 })
  }

  // Per-read canvas noise, which is a different protection from Brave's - Brave
  // seeds per session and per site, so its renders agree with each other inside
  // one page and this stays quiet. Tor and several anti-detect builds do not.
  if (canvas?.unstable === true) {
    evidence.push({ reason: 'canvas-noised-per-read', weight: 0.9 })
  }

  // Brave removes the Network Information API outright; the source reports that
  // as unsupported rather than as an empty value. Absence is weak evidence on
  // any single engine, but a Chromium without `navigator.connection` is unusual.
  if (chromium && statusOf(report, SOURCE.network) === 'unsupported') {
    evidence.push({ reason: 'network-information-api-absent', weight: 0.3 })
  }

  return weigh(evidence)
}

/**
 * The device memory in GiB, if it can be believed, and nothing if it cannot.
 *
 * Returns the value rather than a yes-or-no because every caller wants it as a
 * denominator, and a separate `isTrustworthy` check is one refactor away from
 * a caller that asks the question and then reads the field anyway.
 *
 * The rule is deliberately blunt, because nothing finer is available. Brave
 * draws from exactly the set of values a desktop Chromium can legitimately
 * report, so there is no such thing as a suspicious reading to single out: the
 * farbled 16 and the honest 16 are the same number. Either the browser is
 * known to rewrite this field, in which case every draw is worthless, or it is
 * not, in which case they are all fine.
 */
export function trustedDeviceMemory(report: SignalReport): number | undefined {
  const nav = valueOf<NavigatorSignal>(report, SOURCE.navigator)
  const hardware = valueOf<HardwareSignal>(report, SOURCE.hardware)
  const memory = nav?.device_memory ?? hardware?.device_memory

  if (typeof memory !== 'number' || memory <= 0) return undefined
  return farblesFingerprints(report) ? undefined : memory
}

/**
 * Whether the browser is known to replace fingerprintable values.
 *
 * The narrow question the gates ask, and narrower than the verdict: it wants
 * the tells that are specific to a browser which rewrites values, not the ones
 * that merely correlate with a privacy-minded visitor.
 */
export function farblesFingerprints(report: SignalReport): boolean {
  const shields = valueOf<ShieldsSignal>(report, SOURCE.shields)
  const storage = valueOf<StorageSignal>(report, SOURCE.storage)
  const nav = valueOf<NavigatorSignal>(report, SOURCE.navigator)
  const canvas = valueOf<CanvasSignal>(report, SOURCE.canvas)

  return (
    shields?.brave === true ||
    shields?.brave_claimed === true ||
    shields?.canvas_noise === true ||
    storage?.quota === BRAVE_SYNTHETIC_QUOTA ||
    (typeof nav?.plugin_count === 'number' && nav.plugin_count > CHROMIUM_PLUGIN_COUNT) ||
    canvas?.unstable === true
  )
}

/**
 * There is deliberately no `farbledSources` any more, and the reason is worth
 * keeping.
 *
 * It used to return the source ids a farbling browser rewrites - canvas, webgl,
 * audio, fonts, hardware and the rest - for a caller to drop from an identity.
 * Building that caller for real, in the server's `domain/identity`, showed the
 * shape was wrong: a source is too coarse a unit to drop.
 *
 * `audio` is the clearest case. Brave redraws the rendered buffer, so
 * `audio.value` has to go - measured at 172.52, 172.54, 172.60 and 172.56
 * across four windows on one machine. It does not touch `audio.sample_rate`,
 * which is a perfectly good component and one of the few a Brave visitor has
 * left. Dropping the source drops both. The same is true of `webgl`, whose
 * unmasked vendor and renderer measured identical in all four windows and are
 * the backbone of the candidate bucket, and of `fonts`, which measured the same
 * on Brave as on Chrome.
 *
 * So the list was not merely imprecise, it pointed the wrong way. Every
 * component removed is entropy removed, and removing the stable ones inverts
 * the failure this whole file exists to fix: instead of one person becoming
 * many, many people become one - and a wrong identifier is worse than a missing
 * one, because everything downstream trusts it.
 *
 * The real list is component-level, evidence-led and lives beside the code that
 * uses it, in the server's `domain/identity/shields.go`. What remains here is
 * [[farblesFingerprints]], which answers the only question the SDK itself needs:
 * whether the numbers in this report can be reasoned from at all.
 */
