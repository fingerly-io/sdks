/**
 * The verdicts, from a report.
 *
 * Everything in this folder is a pure function of a [[SignalReport]]. Nothing
 * reads a `window`, a `navigator` or a clock. That is a design constraint
 * rather than an accident of the current implementation:
 *
 *  - the same rules run again server-side, over the stored report, where they
 *    can be improved without an SDK release reaching every customer's site;
 *  - a detector can be tested against a fixture captured from a real device,
 *    which is the only practical way to have a regression test for "Tor Browser
 *    14 on Windows";
 *  - a rule change can be replayed over historical reports to see what it would
 *    have decided, which is not possible if the rule needs a live browser.
 */

import type { SignalReport, Verdicts } from '../types.js'
import { detectAutomation } from './automation.js'
import { detectEmulator } from './emulator.js'
import { detectFarm } from './farm.js'
import { detectIncognito } from './incognito.js'
import { detectShields } from './shields.js'
import { detectTor } from './tor.js'

export { detectAutomation } from './automation.js'
export { detectEmulator } from './emulator.js'
export { detectFarm } from './farm.js'
export { detectIncognito } from './incognito.js'
export {
  BRAVE_SYNTHETIC_QUOTA,
  detectShields,
  farblesFingerprints,
  trustedDeviceMemory,
} from './shields.js'
export { detectTor } from './tor.js'
export { unknown, weigh, type Evidence } from './verdict.js'

export function detectAll(report: SignalReport): Verdicts {
  return {
    incognito: detectIncognito(report),
    shields: detectShields(report),
    tor: detectTor(report),
    emulator: detectEmulator(report),
    automation: detectAutomation(report),
    farm: detectFarm(report),
  }
}
