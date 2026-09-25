/**
 * What the browser says about itself.
 *
 * Everything here is a claim. It is collected because claims are cheap, stable,
 * and - crucially - because a claim is only useful next to the observation that
 * contradicts it. On its own this source proves nothing; paired with
 * `engine.ts` and `lies/`, it is where most contradictions surface.
 */

import {
  SOURCE,
  UnsupportedSignal,
  type LanguagesSignal,
  type NavigatorSignal,
  type PluginsSignal,
  type Source,
  type VendorSignal,
} from '@fingerly/core'

import { attempt, compact } from '../util.js'

interface NavigatorUAData {
  brands?: { brand: string; version: string }[]
  mobile?: boolean
  platform?: string
  getHighEntropyValues?(hints: string[]): Promise<Record<string, unknown>>
}

export const navigatorSource: Source<NavigatorSignal> = {
  id: SOURCE.navigator,
  tier: 'fast',
  run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    const nav = navigator as Navigator & {
      deviceMemory?: number
      pdfViewerEnabled?: boolean
      userAgentData?: NavigatorUAData
    }

    return compact<NavigatorSignal>({
      user_agent: attempt(() => nav.userAgent),
      platform: attempt(() => nav.platform),
      vendor: attempt(() => nav.vendor),
      product_sub: attempt(() => nav.productSub),
      app_version: attempt(() => nav.appVersion),
      hardware_concurrency: attempt(() => nav.hardwareConcurrency),
      device_memory: attempt(() => nav.deviceMemory),
      max_touch_points: attempt(() => nav.maxTouchPoints),
      webdriver: attempt(() => nav.webdriver),
      cookie_enabled: attempt(() => nav.cookieEnabled),
      pdf_viewer_enabled: attempt(() => nav.pdfViewerEnabled),
      do_not_track: attempt(() => nav.doNotTrack),
      // The count rather than the list. The names are long, largely constant,
      // and the only thing any detector reads is whether there are none - a
      // desktop Chromium with zero plugins has no built-in PDF viewer, which
      // means it was built headless.
      plugin_count: attempt(() => nav.plugins?.length),
      mime_type_count: attempt(() => nav.mimeTypes?.length),
      language: attempt(() => nav.language),
      languages: attempt(() => (nav.languages ? [...nav.languages] : undefined)),
    })
  },
}

export const languagesSource: Source<LanguagesSignal> = {
  id: SOURCE.languages,
  tier: 'fast',
  run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    return compact({
      primary: attempt(() => navigator.language),
      accepted: attempt(() => (navigator.languages ? [...navigator.languages] : undefined)),
    })
  },
}

export const vendorSource: Source<VendorSignal> = {
  id: SOURCE.vendor,
  tier: 'fast',
  run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    return compact({ vendor: attempt(() => navigator.vendor) })
  },
}

export const pluginsSource: Source<PluginsSignal> = {
  id: SOURCE.plugins,
  tier: 'fast',
  run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    const plugins = navigator.plugins
    if (!plugins) throw new UnsupportedSignal('no-plugins')

    return {
      plugins: Array.from(plugins, (plugin) => ({
        name: plugin.name,
        filename: plugin.filename,
        description: plugin.description,
        mime_types: Array.from(plugin, (mime) => ({
          type: mime.type,
          suffixes: mime.suffixes,
          description: mime.description,
        })),
      })),
    }
  },
}

/**
 * User-Agent Client Hints.
 *
 * Deferred because `getHighEntropyValues` is a promise that the browser may
 * gate behind a permission prompt in future, and nothing else waits on it.
 */
export const userAgentDataSource: Source<Record<string, unknown>> = {
  id: SOURCE.userAgentData,
  tier: 'deferred',
  timeoutMs: 200,
  async run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    const data = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData
    if (!data) throw new UnsupportedSignal('no-user-agent-data')

    const low = compact({
      brands: data.brands,
      mobile: data.mobile,
      platform: data.platform,
    })

    if (typeof data.getHighEntropyValues !== 'function') return low

    const high = await data.getHighEntropyValues([
      'architecture',
      'bitness',
      'model',
      'platformVersion',
      // Not uaFullVersion: deprecated in the client hints spec, and
      // fullVersionList already carries the same version per brand.
      'fullVersionList',
      'wow64',
    ])

    return { ...low, ...high }
  },
}
