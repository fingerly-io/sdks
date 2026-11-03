/**
 * Signals that disagree with each other.
 *
 * Sources that are independent and land in a flat map never ask whether the
 * user-agent's claimed operating system matches the GPU driver, whether a
 * device claiming to be a phone accepts hover, or whether the timezone is
 * consistent with the locale. A spoofer changes one string and leaves the
 * entire stack behind it untouched, and a flat map of independent sources
 * cannot see that.
 *
 * Everything here reads the outcomes of *other* sources, which is why it runs
 * after collection rather than as a source itself - and why it cannot be
 * starved by the budget, which is exactly what an attacker would want.
 */

import {
  SOURCE,
  valueOf,
  type EngineSignal,
  type ErrorsSignal,
  type Lie,
  type MathSignal,
  type NavigatorSignal,
  type ScreenSignal,
  type SignalOutcome,
  type SignalReport,
  type TouchSignal,
  type WebGLSignal,
} from '@fingerly/core'

/** Enough of a report for the readers in `@fingerly/core` to work on. */
function asReport(sources: Record<string, SignalOutcome>): SignalReport {
  return {
    schema: 1,
    budget_ms: 0,
    elapsed_ms: 0,
    tiers: [],
    sources,
    integrity: { patched_natives: [], lies: [], engine: {} },
  }
}

/** The operating system a user-agent claims. */
function claimedOs(userAgent?: string): string | undefined {
  if (!userAgent) return undefined
  if (/Windows NT/i.test(userAgent)) return 'windows'
  if (/Android/i.test(userAgent)) return 'android'
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  if (/Mac OS X/i.test(userAgent)) return 'macos'
  if (/Linux/i.test(userAgent)) return 'linux'
  return undefined
}

/**
 * The operating system the graphics stack implies.
 *
 * Only the unambiguous markers. Direct3D and ANGLE's D3D backends exist only on
 * Windows; Metal only on Apple platforms. Anything less certain is left
 * undefined rather than guessed, because this feeds a contradiction check and a
 * wrong inference here becomes a false accusation downstream.
 */
function impliedOs(renderer?: string): string | undefined {
  if (!renderer) return undefined
  const r = renderer.toLowerCase()
  if (r.includes('direct3d') || r.includes('d3d11') || r.includes('d3d9')) return 'windows'
  if (r.includes('metal') || r.includes('apple')) return 'apple'
  if (r.includes('adreno') || r.includes('mali') || r.includes('powervr')) return 'mobile'
  return undefined
}

export function findContradictions(sources: Record<string, SignalOutcome>): Lie[] {
  const report = asReport(sources)
  const lies: Lie[] = []

  const nav = valueOf<NavigatorSignal>(report, SOURCE.navigator)
  const engine = valueOf<EngineSignal>(report, SOURCE.engine)
  const errors = valueOf<ErrorsSignal>(report, SOURCE.errors)
  const maths = valueOf<MathSignal>(report, SOURCE.math)
  const webgl = valueOf<WebGLSignal>(report, SOURCE.webgl)
  const touch = valueOf<TouchSignal>(report, SOURCE.touch)
  const screen = valueOf<ScreenSignal>(report, SOURCE.screen)

  // The user-agent says one engine, the engine's own behaviour says another.
  if (engine?.agrees === false) {
    lies.push({
      id: 'user-agent-vs-engine',
      kind: 'contradiction',
      detail: `claimed-${engine.claimed}-observed-${engine.observed}`,
    })
  }

  // Two independent readings of the same engine, taken from different
  // builtins: `engine` reads a RangeError's length, `eval`'s source and the
  // shape of a stack; `errors` reads which non-standard properties an Error
  // carries. Nothing legitimate makes those disagree - a build cannot be V8
  // and SpiderMonkey - so a disagreement is a spoof that got one of them and
  // missed the other.
  if (errors?.observed && engine?.observed && errors.observed !== engine.observed) {
    lies.push({
      id: 'engine-vs-error-shapes',
      kind: 'contradiction',
      detail: `engine-${engine.observed}-errors-${errors.observed}`,
    })
  }

  // The user-agent against the error shapes, for the case where `engine` was
  // the probe that got patched: the two readings then agree with each other
  // and both disagree with the claim.
  //
  // Note that this and the lie above co-fire on one fact whenever the
  // user-agent agrees with the engine, because `errors !== engine` then implies
  // `errors !== claimed`. Both are still recorded - this layer is a record and
  // an [[IntegrityReport]] is explicitly raw - and `detect/automation` is where
  // the pair is collapsed back into the single disagreement it describes.
  const claimed = engine?.claimed
  if (errors?.observed && claimed && errors.observed !== claimed) {
    lies.push({
      id: 'user-agent-vs-error-shapes',
      kind: 'contradiction',
      detail: `claimed-${claimed}-errors-${errors.observed}`,
    })
  }

  // Maths that misses identities exact by specification. Not an unusual CPU:
  // something has replaced `Math`, which is what the extensions that add noise
  // to fingerprintable APIs do.
  if (maths?.identities_hold === false) {
    lies.push({
      id: 'math-identities',
      kind: 'contradiction',
      detail: 'math-builtins-do-not-hold-exact-identities',
    })
  }

  // The user-agent's OS against the graphics stack's.
  const os = claimedOs(nav?.user_agent)
  const gpu = impliedOs(webgl?.unmasked_renderer ?? webgl?.renderer)
  if (os && gpu) {
    const consistent =
      (gpu === 'windows' && os === 'windows') ||
      (gpu === 'apple' && (os === 'macos' || os === 'ios')) ||
      (gpu === 'mobile' && (os === 'android' || os === 'ios'))

    if (!consistent) {
      lies.push({
        id: 'user-agent-vs-gpu',
        kind: 'contradiction',
        detail: `os-${os}-gpu-${gpu}`,
      })
    }
  }

  // `navigator.platform` against the same user-agent that ships beside it.
  // Getting these two to agree is easy and spoofers still forget.
  if (nav?.platform && os) {
    const platform = nav.platform.toLowerCase()
    const consistent =
      (os === 'windows' && platform.startsWith('win')) ||
      (os === 'macos' && platform.startsWith('mac')) ||
      (os === 'ios' && (platform.startsWith('iphone') || platform.startsWith('ipad') || platform.startsWith('mac'))) ||
      (os === 'android' && (platform.startsWith('linux') || platform.startsWith('android'))) ||
      (os === 'linux' && platform.startsWith('linux'))

    if (!consistent) {
      lies.push({
        id: 'user-agent-vs-platform',
        kind: 'contradiction',
        detail: `os-${os}-platform-${nav.platform}`,
      })
    }
  }

  // Touch claimed three ways, which must agree. `maxTouchPoints` is a number a
  // spoofer sets; `(pointer: coarse)` is answered by the compositor.
  if (touch) {
    const points = touch.max_touch_points
    if (typeof points === 'number' && points > 0 && touch.pointer_coarse === false && touch.any_hover === true) {
      lies.push({
        id: 'touch-points-vs-pointer-media',
        kind: 'contradiction',
        detail: 'touch-claimed-with-fine-pointer-and-hover',
      })
    }
    if (touch.touch_event === true && typeof points === 'number' && points === 0) {
      lies.push({
        id: 'touch-event-vs-touch-points',
        kind: 'contradiction',
        detail: 'ontouchstart-present-with-zero-points',
      })
    }
  }

  // A viewport larger than the screen it is supposedly inside.
  if (
    typeof screen?.inner_width === 'number' &&
    typeof screen.width === 'number' &&
    screen.width > 0 &&
    screen.inner_width > screen.width
  ) {
    lies.push({
      id: 'viewport-larger-than-screen',
      kind: 'contradiction',
      detail: `inner-${screen.inner_width}-screen-${screen.width}`,
    })
  }

  // `productSub` is `20030107` on every Chromium and WebKit build there is.
  if (
    nav?.product_sub !== undefined &&
    (engine?.observed === 'chromium' || engine?.observed === 'webkit') &&
    nav.product_sub !== '20030107'
  ) {
    lies.push({
      id: 'product-sub',
      kind: 'contradiction',
      detail: `expected-20030107-got-${nav.product_sub}`,
    })
  }

  // `navigator.language` should be the first entry of `navigator.languages`.
  if (nav?.language && nav.languages && nav.languages.length > 0 && nav.languages[0] !== nav.language) {
    lies.push({
      id: 'language-vs-languages',
      kind: 'contradiction',
      detail: `language-${nav.language}-languages-${nav.languages[0]}`,
    })
  }

  return lies
}
