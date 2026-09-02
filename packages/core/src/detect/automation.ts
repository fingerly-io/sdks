/**
 * Automation detection.
 *
 * The direct tells - `navigator.webdriver`, ChromeDriver's leftover globals -
 * are worth including and worth very little, because anyone running automation
 * seriously removes them in the first hour. What they cannot remove is the
 * evidence of having removed them: patching `navigator.webdriver` means
 * redefining a property, and a redefined property does not have a native
 * getter any more.
 *
 * So the weights here are deliberately inverted relative to how these tells are
 * usually presented. Tampering outweighs the flags. That is the whole argument
 * for the `lies/` layer in `@badele/web-js`, and it is the thing another library
 * has the primitive for - `isFunctionNative` - and calls exactly once, on
 * `window.print`, to detect the PDF viewer.
 */

import {
  SOURCE,
  valueOf,
  type AutomationSignal,
  type EngineSignal,
  type NavigatorSignal,
  type PermissionsSignal,
  type ScreenSignal,
} from '../signals.js'
import type { SignalReport, Verdict } from '../types.js'
import { weigh, type Evidence } from './verdict.js'

/** `navigator.productSub` is this on every Chrome, Safari and Opera build. */
const EXPECTED_PRODUCT_SUB = '20030107'

export function detectAutomation(report: SignalReport): Verdict {
  const evidence: Evidence[] = []

  const automation = valueOf<AutomationSignal>(report, SOURCE.automation)
  const nav = valueOf<NavigatorSignal>(report, SOURCE.navigator)
  const permissions = valueOf<PermissionsSignal>(report, SOURCE.permissions)
  const engine = valueOf<EngineSignal>(report, SOURCE.engine)
  const screen = valueOf<ScreenSignal>(report, SOURCE.screen)
  const integrity = report.integrity

  // --- The declared flags -------------------------------------------------
  if (automation?.webdriver === true || nav?.webdriver === true) {
    evidence.push({ reason: 'navigator-webdriver-true', weight: 1.0 })
  }

  if (automation?.cdp_artifacts && automation.cdp_artifacts.length > 0) {
    evidence.push({ reason: `cdp-artifacts-${automation.cdp_artifacts.length}`, weight: 1.2 })
  }

  if (automation?.distinctive_properties && automation.distinctive_properties.length > 0) {
    evidence.push({
      reason: `automation-globals-${automation.distinctive_properties.join(',')}`,
      weight: 1.0,
    })
  }

  // --- Tampering, which is what survives the flags being removed ----------
  //
  // Weighted highest in the file. A page has no legitimate reason to be running
  // in a browser whose `navigator` getters have been redefined, and stealth
  // plugins have to redefine them precisely to hide the flags above.
  if (integrity.patched_natives.length > 0) {
    const sample = integrity.patched_natives.slice(0, 3).join(',')
    evidence.push({
      reason: `patched-natives-${integrity.patched_natives.length}-${sample}`,
      // Scaled by count, capped: one patched native is suspicious, ten is a
      // stealth plugin, and there is no useful distinction above that.
      weight: Math.min(1.8, 0.9 + 0.3 * integrity.patched_natives.length),
    })
  }

  // Contradictions, counted by fact rather than by finding.
  //
  // `lies` is a raw record - see [[IntegrityReport]] - and two of its entries
  // describe one disagreement. `engine-vs-error-shapes` says the two engine
  // readings differ; `user-agent-vs-error-shapes` says the error shapes differ
  // from the claim. Whenever the user-agent agrees with the engine, which is
  // every honest browser and most dishonest ones, the first implies the second,
  // so a single disagreement arrived here as two contradictions worth 0.5 each
  // and landed exactly on the firing threshold.
  //
  // That is how an ordinary Safari came to be reported as automated: one
  // mis-read engine, scored twice. Both are still listed in `reasons`, because
  // a reviewer should see everything that fired; only the arithmetic changes.
  const contradictions = integrity.lies.filter((lie) => lie.kind === 'contradiction')
  const ids = new Set(contradictions.map((lie) => lie.id))
  const distinctFacts =
    contradictions.length -
    (ids.has('engine-vs-error-shapes') && ids.has('user-agent-vs-error-shapes') ? 1 : 0)

  if (contradictions.length > 0) {
    evidence.push({
      reason: `signal-contradictions-${contradictions.map((lie) => lie.id).join(',')}`,
      weight: Math.min(1.5, 0.5 * distinctFacts),
    })
  }

  const descriptorLies = integrity.lies.filter((lie) => lie.kind === 'descriptor')
  if (descriptorLies.length > 0) {
    evidence.push({
      reason: `redefined-properties-${descriptorLies.map((lie) => lie.id).join(',')}`,
      weight: Math.min(1.4, 0.6 * descriptorLies.length),
    })
  }

  // The engine disagreeing with the user-agent. `engine.agrees` is computed
  // from behaviour a spoofer would have to patch a builtin to change - see
  // [[EngineSignal]] - so a disagreement is either automation or an anti-detect
  // browser, and both are worth the same to a caller.
  if (engine?.agrees === false) {
    evidence.push({
      reason: `engine-mismatch-claimed-${engine.claimed}-observed-${engine.observed}`,
      weight: 1.3,
    })
  }

  // --- Internal invariants, cheap and hard to fake consistently -----------
  if (nav?.product_sub !== undefined && engine?.observed === 'chromium') {
    if (nav.product_sub !== EXPECTED_PRODUCT_SUB) {
      evidence.push({ reason: 'product-sub-inconsistent', weight: 0.8 })
    }
  }

  // The notification-permission contradiction: `Notification.permission` reads
  // `denied` while `permissions.query()` reports `prompt`. Headless Chrome does
  // this because it auto-denies without recording a decision.
  if (permissions?.inconsistent === true) {
    evidence.push({ reason: 'notification-permission-inconsistent', weight: 1.1 })
  }

  // A desktop Chromium with no plugins at all. The built-in PDF viewer registers
  // one, so zero means the browser was built without it - which is headless.
  if (
    engine?.observed === 'chromium' &&
    nav?.plugin_count === 0 &&
    nav.max_touch_points === 0
  ) {
    evidence.push({ reason: 'chromium-desktop-with-no-plugins', weight: 0.7 })
  }

  // A window with no chrome and no size. Headless defaults.
  if (screen?.inner_width === 0 || screen?.inner_height === 0) {
    evidence.push({ reason: 'zero-sized-viewport', weight: 0.8 })
  }

  if (automation?.window_external && /Sequentum/i.test(automation.window_external)) {
    evidence.push({ reason: 'window-external-sequentum', weight: 1.0 })
  }

  return weigh(evidence)
}
