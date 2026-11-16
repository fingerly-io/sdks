/**
 * What the browser claims about itself (`navigator`, `languages`, `vendor`,
 * `plugins`, and `user_agent_data`).
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

import { detectEmbedding } from '../embedding.js'
import { attempt, compact } from '../util.js'

interface NavigatorUAData {
  brands?: { brand: string; version: string }[]
  mobile?: boolean
  platform?: string
  getHighEntropyValues?(hints: string[]): Promise<Record<string, unknown>>
}

export const navigatorSource: Source<NavigatorSignal> = {
  id: SOURCE.navigator,
  stage: 'collect',
  embeddedSafe: true,
  run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    const nav = navigator as Navigator & {
      deviceMemory?: number
      pdfViewerEnabled?: boolean
      userAgentData?: NavigatorUAData
    }

    // The embedded WebView profile (`WEB-07`): only what the server's
    // embedded-claim contradiction check reads. No core count, memory,
    // languages, plugin counts or other device values.
    if (detectEmbedding()) {
      return compact<NavigatorSignal>({
        user_agent: attempt(() => nav.userAgent),
        platform: attempt(() => nav.platform),
        webdriver: attempt(() => nav.webdriver),
      })
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
      plugin_count: attempt(() => nav.plugins?.length),
      mime_type_count: attempt(() => nav.mimeTypes?.length),
      language: attempt(() => nav.language),
      languages: attempt(() => (nav.languages ? [...nav.languages] : undefined)),
    })
  },
}

export const languagesSource: Source<LanguagesSignal> = {
  id: SOURCE.languages,
  stage: 'collect',
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
  stage: 'collect',
  run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    return compact({ vendor: attempt(() => navigator.vendor) })
  },
}

export const pluginsSource: Source<PluginsSignal> = {
  id: SOURCE.plugins,
  stage: 'collect',
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

export const userAgentDataSource: Source<Record<string, unknown>> = {
  id: SOURCE.userAgentData,
  stage: 'collect',
  timeoutMs: 150,
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

    // Only the hint a server rule reads (`WEB-14`): the identity vector uses
    // `architecture`. Bitness, model, platform version, the full version list
    // and wow64 are not requested.
    const high = await data.getHighEntropyValues(['architecture'])
    const architecture = attempt(() => (high as Record<string, unknown>).architecture)

    return typeof architecture === 'string' ? { ...low, architecture } : low
  },
}
