import { describe, expect, it } from 'vitest'

import {
  detectAll,
  detectAutomation,
  detectEmulator,
  detectIncognito,
  detectShields,
  detectTor,
  trustedDeviceMemory,
  farblesFingerprints,
} from '../src/detect/index.js'
import { SOURCE } from '../src/signals.js'
import {
  androidEmulator,
  braveMac,
  currentTorBrowserMac,
  incognitoChromeMac,
  ordinarySafari,
  ordinaryChromeMac,
  ordinaryFirefox,
  privateBraveMac,
  privateFirefox,
  privateFirefoxLegacy,
  privateSafari,
  realAndroidPhone,
  report,
  stealthHeadlessChrome,
  torBrowser,
} from './fixtures.js'

describe('the ordinary case', () => {
  it('fires nothing on an unremarkable Chrome', () => {
    const verdicts = detectAll(ordinaryChromeMac)

    // The most important test in the file. A detector that is right about Tor
    // and wrong about everyone else is worse than no detector, because the
    // cost lands on real customers' real users.
    for (const [name, verdict] of Object.entries(verdicts)) {
      expect(verdict.value, `${name} fired on an ordinary browser`).toBe(false)
    }
  })

  it('fires nothing on a real Android phone', () => {
    const verdicts = detectAll(realAndroidPhone)
    for (const [name, verdict] of Object.entries(verdicts)) {
      expect(verdict.value, `${name} fired on a real phone`).toBe(false)
    }
  })
})

describe('detectIncognito', () => {
  it('flips on a Chromium incognito window, and only the quota changed', () => {
    expect(detectIncognito(ordinaryChromeMac).value).toBe(false)
    expect(detectIncognito(incognitoChromeMac).value).toBe(true)
    expect(detectIncognito(incognitoChromeMac).reasons).toContain('chromium-storage-quota-capped')
  })

  it('detects a Firefox private window by its refused origin filesystem', () => {
    const verdict = detectIncognito(privateFirefox)
    expect(verdict.value).toBe(true)
    expect(verdict.reasons).toContain('firefox-private-origin-filesystem-refused')
  })

  it('leaves an ordinary Firefox window alone, one field away from the private one', () => {
    // The pair that matters. Everything else about these two reports is
    // identical, which is what a Firefox private window actually looks like
    // now: the same storage, the same service worker, the same quota.
    expect(detectIncognito(ordinaryFirefox).value).toBe(false)
    expect(detectIncognito(privateFirefox).value).toBe(true)
  })

  it('still detects a pre-138 Firefox private window by its missing service worker', () => {
    const verdict = detectIncognito(privateFirefoxLegacy)
    expect(verdict.value).toBe(true)
    expect(verdict.reasons).toContain('firefox-no-service-worker-registration')
  })

  it('does not read a Firefox refusal on another engine as a private window', () => {
    // A Chromium frame denied storage access refuses the same call the same
    // way. The engine gate is the only thing between that and a false positive
    // on every visitor it happens to.
    const chromiumRefused = report({
      ...ordinaryChromeMac.sources,
      storage: {
        status: 'ok',
        ms: 1,
        value: {
          local_storage: true,
          session_storage: true,
          indexed_db: true,
          quota: 300_000_000_000,
          quota_ratio: 0.625,
          origin_filesystem: 'refused',
          service_worker: true,
        },
      },
    })

    expect(detectIncognito(chromiumRefused).value).toBe(false)
  })

  it('detects a Safari private window', () => {
    const verdict = detectIncognito(privateSafari)
    expect(verdict.value).toBe(true)
    expect(verdict.reasons).toContain('safari-private-origin-filesystem-refused')
  })

  it('reads the Safari tell reported by an older SDK', () => {
    // Reports stored before the probe reported its outcome raw carry the
    // boolean instead. They are re-scored by this same code.
    const legacySafari = report({
      ...privateSafari.sources,
      storage: {
        status: 'ok',
        ms: 1,
        value: { local_storage: true, session_storage: true, indexed_db: true, safari_private: true },
      },
    })

    expect(detectIncognito(legacySafari).value).toBe(true)
  })

  it('does not apply the Firefox rule to other engines', () => {
    // A Chromium page in an insecure context also has no service worker. The
    // engine gate is what stops that being called a private window.
    const chromiumNoWorker = report({
      ...ordinaryChromeMac.sources,
      storage: {
        status: 'ok',
        ms: 1,
        value: {
          local_storage: true,
          session_storage: true,
          indexed_db: true,
          quota: 300_000_000_000,
          service_worker: false,
        },
      },
    })

    expect(detectIncognito(chromiumNoWorker).value).toBe(false)
  })

  it('says nothing when the storage source did not report', () => {
    const verdict = detectIncognito(report({}))
    expect(verdict.value).toBe(false)
    expect(verdict.reasons).toEqual([])
  })
})

describe('detectTor', () => {
  it('detects Tor Browser with high confidence', () => {
    const verdict = detectTor(torBrowser)

    expect(verdict.value).toBe(true)
    expect(verdict.confidence).toBe('high')
    expect(verdict.reasons[0]).toBe('clock-resolution-clamped-to-100ms')
  })

  it('detects the measured current Tor shape without obsolete RFP constants', () => {
    const verdict = detectTor(currentTorBrowserMac)

    expect(verdict).toEqual({
      value: true,
      confidence: 'medium',
      reasons: ['canvas-readback-refused-or-noised', 'viewport-letterboxed-to-200x100-grid'],
    })
  })

  it('does not fire on an ordinary Firefox private window', () => {
    expect(detectTor(privateFirefox).value).toBe(false)
  })

  it('does not fire on ordinary Chrome', () => {
    expect(detectTor(ordinaryChromeMac).value).toBe(false)
  })

  it('discounts RFP tells that appear on a non-Gecko engine', () => {
    const notFirefox = report({
      ...torBrowser.sources,
      engine: {
        status: 'ok',
        ms: 1,
        value: { observed: 'chromium', claimed: 'chromium', agrees: true },
      },
    })

    const verdict = detectTor(notFirefox)
    expect(verdict.reasons).toContain('rfp-tells-on-non-gecko-engine')
    // Still true - those countermeasures are real and worth reporting - but
    // scored lower than the genuine article, which is the intent.
    expect(verdict.confidence).not.toBe('high')
  })
})

describe('detectAutomation', () => {
  it('catches a stealth-plugin headless Chrome despite webdriver being false', () => {
    const verdict = detectAutomation(stealthHeadlessChrome)

    expect(verdict.value).toBe(true)
    expect(verdict.confidence).toBe('high')

    // The flag it removed is not what caught it.
    expect(verdict.reasons.some((r) => r.startsWith('patched-natives-'))).toBe(true)
    expect(verdict.reasons.some((r) => r.startsWith('engine-mismatch-'))).toBe(true)
    expect(verdict.reasons).toContain('notification-permission-inconsistent')
  })

  it('catches plain automation that did not bother hiding', () => {
    const plain = report({
      ...ordinaryChromeMac.sources,
      automation: { status: 'ok', ms: 1, value: { webdriver: true } },
    })

    expect(detectAutomation(plain).value).toBe(true)
    expect(detectAutomation(plain).reasons).toContain('navigator-webdriver-true')
  })

  it('does not fire on an ordinary browser', () => {
    expect(detectAutomation(ordinaryChromeMac).value).toBe(false)
  })

  it('will not call a browser automated on one removable flag alone', () => {
    const onlyFlag = report({
      automation: { status: 'ok', ms: 1, value: { webdriver: true } },
    })

    const verdict = detectAutomation(onlyFlag)
    expect(verdict.value).toBe(true)
    // True, but never `high` - that needs corroboration, which is the policy
    // encoded in the thresholds in verdict.ts.
    expect(verdict.confidence).toBe('low')
  })
})

describe('detectEmulator', () => {
  it('detects an Android emulator', () => {
    const verdict = detectEmulator(androidEmulator)

    expect(verdict.value).toBe(true)
    expect(verdict.confidence).toBe('high')
    expect(verdict.reasons).toContain('software-renderer-swiftshader')
    expect(verdict.reasons).toContain('mobile-ua-without-touch-points')
  })

  it('does not fire on a real phone', () => {
    expect(detectEmulator(realAndroidPhone).value).toBe(false)
  })

  it('weighs a software renderer lightly on desktop, where VMs are legitimate', () => {
    const desktopVm = report({
      ...ordinaryChromeMac.sources,
      webgl: {
        status: 'ok',
        ms: 1,
        value: { renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)', unmasked_renderer: 'llvmpipe' },
      },
    })

    const verdict = detectEmulator(desktopVm)
    expect(verdict.reasons).toContain('software-renderer-llvmpipe')
    // Reported, not concluded: a developer on a VM or a remote desktop session
    // is an ordinary visitor.
    expect(verdict.value).toBe(false)
  })

  it('says nothing when neither webgl nor navigator reported', () => {
    expect(detectEmulator(report({})).reasons).toEqual([])
  })
})

describe('verdict shape', () => {
  it('orders reasons by weight, strongest first', () => {
    const verdict = detectTor(torBrowser)
    expect(verdict.reasons[0]).toBe('clock-resolution-clamped-to-100ms')
  })

  it('always returns every verdict, even for an empty report', () => {
    const verdicts = detectAll(report({}))
    expect(Object.keys(verdicts).sort()).toEqual([
      'automation',
      'emulator',
      'farm',
      'incognito',
      'shields',
      'tor',
    ])
  })
})

describe('anti-fingerprinting countermeasures', () => {
  it('does not call an ordinary Brave window a private one', () => {
    // The regression this whole file exists for. Brave pins
    // `storage.estimate().quota` to 2 GiB and reseeds `deviceMemory` per
    // session, so the old ratio test computed 2/16 = 0.125 against a 0.3
    // ceiling and reported every Brave visitor on the web to be browsing
    // privately - from an ordinary window, at medium confidence, with a
    // reason that read perfectly plausibly.
    const verdict = detectIncognito(braveMac)

    expect(verdict.value).toBe(false)
    expect(verdict.reasons).toEqual([])
  })

  it('reports the countermeasures instead, which is the honest finding', () => {
    const verdict = detectShields(braveMac)

    expect(verdict.value).toBe(true)
    expect(verdict.confidence).toBe('high')
    expect(verdict.reasons).toContain('storage-quota-is-brave-constant')
    expect(verdict.reasons).toContain('brave-vendor-api')
    expect(verdict.reasons).toContain('plugin-list-padded')
  })

  it('fires nothing but `shields` on Brave', () => {
    // Running a privacy browser is not evidence of anything else. Every other
    // detector has to stay quiet, or the fix has just moved the false positive
    // from one verdict to another.
    const verdicts = detectAll(braveMac)

    expect(verdicts.shields.value).toBe(true)
    for (const [name, verdict] of Object.entries(verdicts)) {
      if (name === 'shields') continue
      expect(verdict.value, `${name} fired on an ordinary Brave window`).toBe(false)
    }
  })

  it('refuses to divide by a farbled device memory', () => {
    expect(trustedDeviceMemory(braveMac)).toBeUndefined()
    expect(trustedDeviceMemory(privateBraveMac)).toBeUndefined()
    // And still hands back an honest one, or the gate has eaten the signal
    // for every visitor rather than for the browsers that earned it.
    expect(trustedDeviceMemory(ordinaryChromeMac)).toBe(8)
  })

  it('does not mistake a large ordinary machine for a farbled one', () => {
    // The rule that was one commit from shipping: `deviceMemory > 8 means
    // farbling`. Chromium clamps to [2, 32] on desktop, so 16 is what an
    // ordinary Chrome on a 16GB machine reports, and that rule would have
    // fired on every one of them.
    const bigChrome = report({
      ...ordinaryChromeMac.sources,
      [SOURCE.navigator]: {
        status: 'ok',
        ms: 1,
        value: {
          ...(ordinaryChromeMac.sources[SOURCE.navigator]?.value as object),
          device_memory: 32,
        },
      },
    })

    expect(detectShields(bigChrome).value).toBe(false)
    expect(trustedDeviceMemory(bigChrome)).toBe(32)
    expect(detectIncognito(bigChrome).value).toBe(false)
  })


  it('still reads the legacy quota when the modern one has been pinned', () => {
    // The whole reason the second reading exists. Brave patches the binding
    // behind `storage.estimate()`; `webkitTemporaryStorage` reaches the same
    // quota manager without passing through it, and reported 10 GiB from this
    // window against 3 GiB from the private one while `quota` said 2 GiB in
    // both. An absolute test on a real 3 GiB is a miss, not a false positive.
    const chromeQuota = incognitoChromeMac.sources[SOURCE.storage]?.value as { quota?: number }
    expect(chromeQuota.quota).toBeLessThan(1_073_741_824)
    expect(detectIncognito(incognitoChromeMac).reasons).toContain('chromium-storage-quota-capped')
  })

  it('detects a Brave private window by the pool the farbling does not reach', () => {
    // Recovered after Chrome 152 made the ordinary quota useless. Brave took
    // Chromium's static quota for normal windows - its legacy reading is the
    // 10 GiB constant - without taking `kIncognitoStaticStorageQuota`, so a
    // private window still reports the memory-derived pool at 3 GiB. A reading
    // below the constant therefore did not come from an ordinary window, and
    // getting there costs no device memory, which is why it works where the
    // ratio does not.
    const verdict = detectIncognito(privateBraveMac)

    expect(verdict.value).toBe(true)
    expect(verdict.reasons).toContain('chromium-quota-below-static-pool')
    // And the ordinary Brave window it has to be told apart from.
    expect(detectIncognito(braveMac).value).toBe(false)
  })

  it('detects a Chrome 152 incognito window by an fsync that costs nothing', () => {
    // The tell that outlived the quota. Chrome 152 reports `usage + 10 GiB`
    // from both windows on purpose, so every value-based test is blind here -
    // but an incognito profile has no disk to sync to, and a `durability:
    // "strict"` commit against an in-memory LevelDB is free. On disk it is the
    // most expensive part of the transaction.
    const chrome152Incognito = report({
      ...ordinaryChromeMac.sources,
      [SOURCE.storageDurability]: {
        status: 'ok',
        ms: 480,
        // Measured: Chrome 152 incognito, M1 Pro, median of 15 rounds.
        value: { ratio: 1.0, rounds: 9, honored: true },
      },
    })

    const verdict = detectIncognito(chrome152Incognito)
    expect(verdict.value).toBe(true)
    expect(verdict.reasons).toContain('chromium-indexeddb-writes-are-not-durable')
    // The ordinary window it has to be told apart from differs in nothing else.
    expect(detectIncognito(ordinaryChromeMac).value).toBe(false)
  })

  it('abstains when the durability probe did not get enough rounds', () => {
    // A median over two readings is not a median, and a report with too few of
    // them was taken on a machine too loaded to measure - which is exactly
    // where answering anyway turns a slow phone into a false positive.
    const rushed = report({
      ...ordinaryChromeMac.sources,
      [SOURCE.storageDurability]: {
        status: 'ok',
        ms: 600,
        value: { ratio: 1.01, rounds: 2, honored: true },
      },
    })

    expect(detectIncognito(rushed).value).toBe(false)
  })

  it('abstains when the engine ignored the durability hint', () => {
    // An engine that does not honour `durability` runs both halves of the ratio
    // identically, which reads as in-memory on every machine on earth. The
    // source says so rather than reporting a 1.0 that means nothing.
    const notHonored = report({
      ...ordinaryChromeMac.sources,
      [SOURCE.storageDurability]: {
        status: 'ok',
        ms: 30,
        value: { honored: false },
      },
    })

    expect(detectIncognito(notHonored).value).toBe(false)
  })

  it('reaches high confidence when the quota and the clock agree', () => {
    // Brave private trips both: the pool below the static constant, and the
    // fsync that costs nothing. Two independent readings agreeing is what the
    // `high` band is reserved for - neither reaches it alone, and that is the
    // point of weighting rather than chaining.
    const verdict = detectIncognito(privateBraveMac)

    expect(verdict.value).toBe(true)
    expect(verdict.confidence).toBe('high')
    expect(verdict.reasons).toContain('chromium-indexeddb-writes-are-not-durable')
    expect(verdict.reasons).toContain('chromium-quota-below-static-pool')
  })

  it('reads nothing into Chromium\'s static quota, in either window', () => {
    // Chrome 152 reports `usage + 10 GiB` from both windows on purpose -
    // the flag is called `kIncognitoStaticStorageQuota` and its comment says
    // it is there "to avoid fingerprinting and incognito detection". Both
    // windows are therefore the same report, and the only correct answer is
    // the same answer. An incognito Chrome 152 is a miss, not a false positive.
    const chrome152 = (usage: number) =>
      report({
        ...ordinaryChromeMac.sources,
        [SOURCE.storage]: {
          status: 'ok',
          ms: 1,
          value: {
            local_storage: true,
            session_storage: true,
            indexed_db: true,
            quota: 10_737_418_240 + usage,
            usage,
            legacy_quota: 10_737_418_240 + usage,
            origin_filesystem: 'ok',
            service_worker: true,
          },
        },
      })

    expect(detectIncognito(chrome152(0)).value).toBe(false)
    // The usage has to come off before the constant is recognisable.
    expect(detectIncognito(chrome152(524_288_000)).value).toBe(false)
  })

  it('does not read a small quota on a small disk as a private window', () => {
    // The inversion. Below the constant Chromium reports the disk size rounded
    // up, and only for an ordinary window - the incognito path stays pinned. So
    // on a current build a small quota is evidence *against* a private window,
    // and the rule that read it the other way fired on every visitor whose
    // laptop was full.
    const fullDisk = report({
      ...ordinaryChromeMac.sources,
      [SOURCE.storage]: {
        status: 'ok',
        ms: 1,
        value: {
          local_storage: true,
          session_storage: true,
          indexed_db: true,
          // 0.29 of 16GiB - under the old 0.3 ceiling, over the new 0.25 one.
          quota: 5_000_000_000,
          usage: 0,
          origin_filesystem: 'ok',
          service_worker: true,
        },
      },
    })

    expect(detectIncognito(fullDisk).value).toBe(false)
  })
})

describe('Safari is not a spoofed Chromium', () => {
  it('fires nothing on an ordinary Safari', () => {
    // Measured on Safari 26.5. It reported `automation: true` here, which is
    // the worst false positive in the codebase by consequence: the customer
    // acts on that one.
    const verdicts = detectAll(ordinarySafari)

    for (const [name, verdict] of Object.entries(verdicts)) {
      expect(verdict.value, `${name} fired on an ordinary Safari`).toBe(false)
    }
  })

  it('scores one engine disagreement once, not twice', () => {
    // The amplifier. `errors !== engine` implies `errors !== claimed` whenever
    // the user-agent agrees with the engine, so emitting both lies scored a
    // single fact at 0.5 + 0.5 = 1.0 - exactly `detect/automation`'s firing
    // threshold. One mis-read engine was therefore enough on its own, which is
    // what turned a wrong vote into a verdict about a real person's browser.
    const oneContradiction = report(
      { ...ordinarySafari.sources },
      {
        lies: [
          {
            id: 'engine-vs-error-shapes',
            kind: 'contradiction',
            detail: 'engine-webkit-errors-chromium',
          },
          // Recorded, because the record is raw - and implied by the line
          // above, so it must not be scored a second time.
          {
            id: 'user-agent-vs-error-shapes',
            kind: 'contradiction',
            detail: 'claimed-webkit-errors-chromium',
          },
        ],
      },
    )

    const verdict = detectAutomation(oneContradiction)
    expect(verdict.value).toBe(false)
    // Both are still shown to a reviewer; only the arithmetic collapses them.
    expect(verdict.reasons.join()).toContain('engine-vs-error-shapes')
    expect(verdict.reasons.join()).toContain('user-agent-vs-error-shapes')
  })

  it('still fires when two independent contradictions really are two facts', () => {
    // The fix must not have disarmed the rule. Two unrelated contradictions
    // are still two, and still reach the threshold.
    const genuinelySpoofed = report(
      { ...ordinarySafari.sources },
      {
        lies: [
          { id: 'engine-vs-error-shapes', kind: 'contradiction', detail: 'engine-webkit-errors-chromium' },
          { id: 'user-agent-vs-platform', kind: 'contradiction', detail: 'os-windows-platform-macintel' },
        ],
      },
    )

    expect(detectAutomation(genuinelySpoofed).value).toBe(true)
  })
})

describe('canvas noise', () => {
  it('counts a noised canvas canary as a browser rewriting values', () => {
    const noised = report({ [SOURCE.shields]: { status: 'ok', ms: 1, value: { canvas_noise: true } } })
    const clean = report({ [SOURCE.shields]: { status: 'ok', ms: 1, value: { canvas_noise: false } } })
    expect(farblesFingerprints(noised)).toBe(true)
    expect(farblesFingerprints(clean)).toBe(false)
  })
})
