// @vitest-environment happy-dom

/**
 * Recognising a page that runs inside an app (server ADR 0024, Appendix B).
 *
 * The user-agent rows are a literal copy of the server's table in
 * `tests/unit/agent_embedded_test.go`; change both together. Rows 1, 5, 6 and
 * 7 are the server's alone: the marker is this SDK's own output, and a page
 * does not know its key's environment. Rows 2 to 4 are read here from
 * `location.protocol`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FingerlyClient } from '@fingerly/core'

import { browserSources, detectEmbedding, load } from '../src/index.js'

const UA = {
  safariIPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  chromeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240305.019; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36',
  iPhoneWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iPadWebView: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  macWebView: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  electron: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.137 Electron/33.0.0 Safari/537.36',
  chromeIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  firefoxIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  firefoxDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  instagramIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0 (iPhone15,2; iOS 17_0; en_GB; en; scale=3.00; 1179x2556; 123456789)',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240305.019; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0.0;]',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the shared table', () => {
  const rows: [string, string, string, string | undefined][] = [
    ['2 Capacitor on iOS', UA.safariIPhone, 'capacitor:', 'app-scheme'],
    ['3 Ionic on iOS', UA.chromeDesktop, 'ionic:', 'app-scheme'],
    ['4 Cordova on iOS', UA.chromeDesktop, 'app:', 'app-scheme'],
    ['8 Android WebView', UA.androidWebView, 'https:', 'android-webview'],
    ['9 iPhone WKWebView', UA.iPhoneWebView, 'https:', 'apple-webview'],
    ['10 iPad WKWebView', UA.iPadWebView, 'https:', 'apple-webview'],
    ['11 Mac WKWebView', UA.macWebView, 'https:', 'apple-webview'],
    ['12 Electron', UA.electron, 'https:', 'electron'],
    ['13 Safari on iPhone', UA.safariIPhone, 'https:', undefined],
    ['14 Chrome on iOS', UA.chromeIOS, 'https:', undefined],
    ['15 Firefox on iOS', UA.firefoxIOS, 'https:', undefined],
    ['16 Safari on macOS', UA.safariMac, 'https:', undefined],
    ['17 Chrome on Android', UA.chromeAndroid, 'https:', undefined],
    ['18 Firefox desktop', UA.firefoxDesktop, 'https:', undefined],
    ['19 Instagram on iOS', UA.instagramIOS, 'https:', undefined],
    ['20 Facebook on Android', UA.facebookAndroid, 'https:', undefined],
    ['21 an app origin beats the in-app browser exception', UA.instagramIOS, 'capacitor:', 'app-scheme'],
    ['22 nothing at all', '', '', undefined],
    ['23 curl', 'curl/8.4.0', '', undefined],
  ]
  for (const [name, userAgent, protocol, want] of rows) {
    it(name, () => {
      expect(detectEmbedding({ userAgent, protocol, window: {} })).toBe(want)
    })
  }
})

describe('the bridges only a page can see', () => {
  it.each([
    ['capacitor', { Capacitor: { isNativePlatform: () => true } }],
    ['cordova', { cordova: {} }],
    ['cordova', { _cordovaNative: {} }],
    ['react-native-webview', { ReactNativeWebView: { postMessage: () => {} } }],
    ['flutter-webview', { flutter_inappwebview: {} }],
  ])('%s', (want, window) => {
    expect(detectEmbedding({ userAgent: UA.safariIPhone, protocol: 'https:', window })).toBe(want)
  })

  it('beat the in-app browser exception', () => {
    expect(detectEmbedding({ userAgent: UA.instagramIOS, protocol: 'https:', window: { cordova: {} } })).toBe('cordova')
  })

  it('a Capacitor web build is a browser', () => {
    expect(detectEmbedding({ userAgent: UA.safariIPhone, protocol: 'https:', window: { Capacitor: { isNativePlatform: () => false } } })).toBeUndefined()
  })

  it('a frame the page made itself is a browser', () => {
    expect(detectEmbedding({ userAgent: UA.safariIPhone, protocol: 'about:', window: {} })).toBeUndefined()
  })
})

describe('load() in an app', () => {
  it('runs no source and cannot be told otherwise', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const run = vi.fn(() => 1)
    const submit = vi.fn(async () => ({ request_id: 'r', visitor_id: 'v' }))

    const fingerly = await load({
      apiKey: 'fly_pk_development_test',
      consent: 'granted',
      sources: [{ id: 'probe', tier: 'fast', run }],
      transport: { submit },
      // Not in the type, and overridden anyway: there is no way to opt out.
      ...({ embedding: () => undefined } as object),
    })
    const report = await fingerly.collect()

    expect(run).not.toHaveBeenCalled()
    expect(report.sources).toEqual({ embedding: { status: 'ok', ms: 0, value: { kind: 'capacitor' } } })
  })

  it('browserSources used directly read nothing', async () => {
    vi.stubGlobal('ReactNativeWebView', { postMessage: () => {} })
    const createElement = vi.spyOn(document, 'createElement')
    const fingerly = new FingerlyClient({
      apiKey: 'fly_pk_development_test',
      consent: 'granted',
      sources: browserSources,
      transport: { submit: vi.fn() },
    })

    const report = await fingerly.collect()

    expect(createElement).not.toHaveBeenCalled()
    for (const outcome of Object.values(report.sources)) {
      expect(outcome).toMatchObject({ status: 'unsupported', reason: 'embedded' })
    }
  })
})
