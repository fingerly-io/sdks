// @vitest-environment happy-dom

import { BlockedSignal, UnsupportedSignal } from '@fingerly/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applePaySource, codecsSource, intlSource } from '../src/sources/device.js'
import { webgpuSource } from '../src/sources/render.js'
import { voicesSource } from '../src/sources/text.js'

const makeCtx = () =>
  ({
    signal: new AbortController().signal,
    budgetRemainingMs: () => 200,
    completed: () => undefined,
  }) as never

describe('Safari mode-invariant collectors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('voicesSource canonicalises and sorts voices, and omits empty ATFP-tainted lists', async () => {
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [
        { name: 'Samantha', lang: 'en-US', localService: true, default: true },
        { name: 'Ava (Enhanced)', lang: 'en-US', localService: true, default: false },
        { name: 'Yelda', lang: 'tr-TR', localService: true, default: false },
      ],
    })

    const populated = await voicesSource.run(makeCtx())
    expect(populated).toEqual({
      voices: ['Ava (Enhanced)|en-US|1', 'Samantha|en-US|1', 'Yelda|tr-TR|1'],
      default_voice: 'Samantha|en-US',
    })

    // Safari 26 ScriptTrackingPrivacy withholds getVoices() -> []
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [],
      addEventListener: (_evt: string, cb: () => void) => setTimeout(cb, 5),
      removeEventListener: () => {},
    })
    const withheld = await voicesSource.run(makeCtx())
    expect(withheld).toEqual({})
  })

  it('applePaySource requires secureContext, captures version ceiling, and converts InvalidAccessError to BlockedSignal', () => {
    const win = window as unknown as Record<string, unknown>
    const prevSecure = window.isSecureContext

    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    expect(() => applePaySource.run(makeCtx())).toThrow(UnsupportedSignal)

    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    win.ApplePaySession = {
      canMakePayments: () => true,
      supportsVersion: (v: number) => v <= 14,
    }
    expect(applePaySource.run(makeCtx())).toEqual({
      can_make_payments: true,
      max_version: 14,
    })

    win.ApplePaySession = {
      canMakePayments: () => {
        throw new DOMException('Disallowed in cross-origin frame', 'InvalidAccessError')
      },
    }
    expect(() => applePaySource.run(makeCtx())).toThrow(BlockedSignal)

    delete win.ApplePaySession
    Object.defineProperty(window, 'isSecureContext', { value: prevSecure, configurable: true })
  })

  it('codecsSource strips repair pseudo-codecs and records hardware powerEfficient decode flags', async () => {
    vi.stubGlobal('RTCRtpSender', {
      getCapabilities: () => ({
        codecs: [
          { mimeType: 'video/rtx' },
          { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=640c1f' },
          { mimeType: 'video/AV1' },
        ],
      }),
    })
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaCapabilities: {
        decodingInfo: async ({ video }: { video: { contentType: string } }) => ({
          supported: true,
          powerEfficient: video.contentType.includes('av01') || video.contentType.includes('hvc1'),
        }),
      },
    })

    const out = await codecsSource.run(makeCtx())
    expect(out).toEqual({
      rtc_video: ['video/av1', 'video/h264|profile-level-id=640c1f'],
      hw_av1: true,
      hw_hevc10: true,
      hw_vp9_p2: false,
    })
  })

  it('webgpuSource reads sorted adapter features and numeric limits without requesting a device', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      gpu: {
        requestAdapter: async () => ({
          features: new Set(['shader-f16', 'float32-filterable']),
          limits: { maxBufferSize: 1073741824, maxComputeWorkgroupStorageSize: 32768 },
          info: { vendor: 'apple', architecture: 'apple' },
        }),
      },
    })

    const out = await webgpuSource.run(makeCtx())
    expect(out).toEqual({
      features: ['float32-filterable', 'shader-f16'],
      limits: { maxBufferSize: 1073741824, maxComputeWorkgroupStorageSize: 32768 },
      vendor: 'apple',
      architecture: 'apple',
    })
  })

  it('intlSource exposes hour_cycle', () => {
    const out = intlSource.run(makeCtx()) as Record<string, unknown>
    expect(typeof out.hour_cycle === 'string' || out.hour_cycle === undefined).toBe(true)
  })
})
