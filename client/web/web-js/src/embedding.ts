/**
 * Is this page running inside an app?
 *
 * A page inside a customer's own app is the app reading the device. Apple's
 * agreement forbids an app to "derive any data from a device for the purpose
 * of uniquely identifying it", naming the properties of a web browser among
 * that data, so the browser SDK collects nothing there. Use the iOS or Android
 * SDK in an app instead.
 *
 * The rules are the table in the server's ADR 0024 (Appendix B), which the
 * server applies to every report as well. Rows shared with the server are
 * copied literally into `tests/embedding.test.ts`; change both together.
 *
 * Reading the user agent, `location` and a few globals is itself a read of the
 * device, so this runs only once consent is granted, from `identify()` and
 * `collect()` and the guarded sources.
 */

/** What the page can see of where it runs. Defaults to the real page. */
export interface EmbeddingEnvironment {
  userAgent?: string
  protocol?: string
  window?: Record<string, unknown>
}

/**
 * The built-in browsers of other companies' apps. There the person is browsing
 * the open web inside somebody else's app, with no customer app involved, so
 * they are browsers. Only the user-agent rules give way to this list.
 */
const THIRD_PARTY_IN_APP_BROWSERS = [
  'fban/', 'fbav/', 'fb_iab', 'instagram', 'musical_ly', 'bytedancewebview',
  'snapchat', 'linkedinapp', 'line/', 'micromessenger', 'pinterest/', 'gsa/',
]

function pageEnvironment(): EmbeddingEnvironment {
  const g = globalThis as unknown as { navigator?: { userAgent?: string }; location?: { protocol?: string } }
  return {
    ...(typeof g.navigator?.userAgent === 'string' ? { userAgent: g.navigator.userAgent } : {}),
    ...(typeof g.location?.protocol === 'string' ? { protocol: g.location.protocol } : {}),
    window: globalThis as unknown as Record<string, unknown>,
  }
}

/** A JavaScript bridge proves the page is in an app, whatever it claims to be. */
function bridgeOf(win: Record<string, unknown>): string | undefined {
  try {
    const capacitor = win['Capacitor'] as { isNativePlatform?: () => boolean } | undefined
    if (capacitor && typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform() === true) {
      return 'capacitor'
    }
    if (win['cordova'] !== undefined || win['_cordovaNative'] !== undefined) return 'cordova'
    if (win['ReactNativeWebView'] !== undefined) return 'react-native-webview'
    if (win['flutter_inappwebview'] !== undefined) return 'flutter-webview'
  } catch {
    // A getter that throws is not evidence either way.
  }
  return undefined
}

/** Rules 4 to 6 and the third-party exception, as the server applies them. */
export function userAgentEmbedding(userAgent: string): string | undefined {
  const ua = userAgent.toLowerCase()
  if (ua === '') return undefined
  if (ua.includes('electron/')) return 'electron'
  if (THIRD_PARTY_IN_APP_BROWSERS.some((needle) => ua.includes(needle))) return undefined
  if (ua.includes('android') && ua.includes('; wv)')) return 'android-webview'
  const appleDevice = ['iphone', 'ipad', 'ipod', 'macintosh'].some((device) => ua.includes(device))
  if (appleDevice && ua.includes('applewebkit/') && !ua.includes('safari/')) return 'apple-webview'
  return undefined
}

/**
 * The kind of app this page runs in, or undefined in a browser.
 *
 * Order: the page's own scheme, then a bridge, then the user agent. The first
 * two are checked before the third-party exception, because either proves the
 * page belongs to the customer's app.
 */
export function detectEmbedding(environment: EmbeddingEnvironment = pageEnvironment()): string | undefined {
  const protocol = (environment.protocol ?? '').toLowerCase()
  // `about:` and `blob:` are frames a browser page made itself, not an app.
  if (protocol !== '' && !['http:', 'https:', 'about:', 'blob:'].includes(protocol)) return 'app-scheme'
  const bridge = environment.window ? bridgeOf(environment.window) : undefined
  if (bridge) return bridge
  return userAgentEmbedding(environment.userAgent ?? '')
}
