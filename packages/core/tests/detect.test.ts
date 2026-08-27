import { describe, expect, it } from 'vitest'

import {
  detectAll,
  detectAutomation,
  detectEmulator,
  detectIncognito,
  detectTor,
} from '../src/detect/index.js'
import {
  androidEmulator,
  incognitoChromeMac,
  ordinaryChromeMac,
  privateFirefox,
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

  it('detects a Firefox private window by its missing service worker', () => {
    const verdict = detectIncognito(privateFirefox)
    expect(verdict.value).toBe(true)
    expect(verdict.reasons).toContain('firefox-no-service-worker-registration')
  })

  it('detects a Safari private window', () => {
    const verdict = detectIncognito(privateSafari)
    expect(verdict.value).toBe(true)
    expect(verdict.reasons).toContain('safari-private-origin-filesystem-refused')
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
      'tor',
    ])
  })
})
