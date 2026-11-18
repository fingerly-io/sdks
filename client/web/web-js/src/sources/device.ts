/**
 * Device capability: hardware concurrency/memory, touch/motion interface presence,
 * attached media device counts, network hints, and locale/timezone.
 */

import {
  BlockedSignal,
  SOURCE,
  UnsupportedSignal,
  type ApplePaySignal,
  type CodecsSignal,
  type HardwareSignal,
  type IntlSignal,
  type MediaDevicesSignal,
  type NetworkSignal,
  type Source,
  type TimezoneSignal,
  type TouchSignal,
} from '@fingerly/core'

import { attempt, compact, requireWindow } from '../util.js'

export const hardwareSource: Source<HardwareSignal> = {
  id: SOURCE.hardware,
  stage: 'collect',
  run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    const nav = navigator as Navigator & { deviceMemory?: number }

    return compact<HardwareSignal>({
      hardware_concurrency: attempt(() => nav.hardwareConcurrency),
      device_memory: attempt(() => nav.deviceMemory),
    })
  },
}

export const touchSource: Source<TouchSignal> = {
  id: SOURCE.touch,
  stage: 'collect',
  run() {
    const w = requireWindow()

    return compact<TouchSignal>({
      max_touch_points: attempt(() => navigator.maxTouchPoints),
      touch_event: attempt(() => 'ontouchstart' in w),
      touch_start: attempt(() => {
        document.createEvent('TouchEvent')
        return true
      }),
      pointer_coarse: attempt(() => w.matchMedia?.('(pointer: coarse)').matches),
      any_hover: attempt(() => w.matchMedia?.('(any-hover: hover)').matches),
      device_motion: attempt(() => 'DeviceMotionEvent' in w),
      device_orientation: attempt(() => 'DeviceOrientationEvent' in w),
    })
  },
}

export const mediaDevicesSource: Source<MediaDevicesSignal> = {
  id: SOURCE.mediaDevices,
  stage: 'collect',
  timeoutMs: 120,
  async run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    if (typeof navigator.mediaDevices?.enumerateDevices !== 'function') {
      throw new UnsupportedSignal('no-media-devices')
    }

    const devices = await navigator.mediaDevices.enumerateDevices()

    return compact<MediaDevicesSignal>({
      audio_input: devices.filter((d) => d.kind === 'audioinput').length,
      audio_output: devices.filter((d) => d.kind === 'audiooutput').length,
      video_input: devices.filter((d) => d.kind === 'videoinput').length,
      labels_hidden: devices.length > 0 && devices.every((d) => d.label === ''),
    })
  },
}

export const networkSource: Source<NetworkSignal> = {
  id: SOURCE.network,
  stage: 'collect',
  run() {
    const connection = (
      navigator as Navigator & {
        connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }
      }
    ).connection
    if (!connection) throw new UnsupportedSignal('no-network-information')

    return compact<NetworkSignal>({
      effective_type: attempt(() => connection.effectiveType),
      downlink: attempt(() => connection.downlink),
      rtt: attempt(() => connection.rtt),
      save_data: attempt(() => connection.saveData),
    })
  },
}

export const intlSource: Source<IntlSignal> = {
  id: SOURCE.intl,
  stage: 'collect',
  run() {
    if (typeof Intl === 'undefined') throw new UnsupportedSignal('no-intl')

    const resolved = attempt(() => new Intl.DateTimeFormat().resolvedOptions())
    const hourCycle = attempt(
      () =>
        (
          new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions() as Intl.ResolvedDateTimeFormatOptions & {
            hourCycle?: string
          }
        ).hourCycle,
    )

    return compact<IntlSignal>({
      timezone: resolved?.timeZone,
      timezone_offset: attempt(() => new Date().getTimezoneOffset()),
      locale: resolved?.locale,
      calendar: resolved?.calendar,
      numbering_system: resolved?.numberingSystem,
      hour_cycle: hourCycle,
      formatted: attempt(() =>
        new Intl.DateTimeFormat(undefined, {
          dateStyle: 'full',
          timeStyle: 'full',
        }).format(new Date(0)),
      ),
    })
  },
}

const REPAIR_CODECS = new Set(['video/rtx', 'video/red', 'video/ulpfec', 'video/flexfec-03'])

/**
 * One answer per content type for the life of the page. The first
 * `decodingInfo` call on a cold media stack can take longer than the source's
 * timeout, so the queries are started as soon as collection is permitted
 * ([warmCodecs]) and the source then awaits the same promises.
 */
const decodeAnswers = new Map<string, Promise<boolean | undefined>>()

/** The hardware-decode probes the codecs source reads. */
const HW_DECODE_TYPES = [
  'video/mp4; codecs="av01.0.08M.08"',
  'video/mp4; codecs="hvc1.2.4.L120.B0"',
  'video/webm; codecs="vp09.02.10.10"',
] as const

function isPowerEfficientDecode(contentType: string): Promise<boolean | undefined> {
  let answer = decodeAnswers.get(contentType)
  if (!answer) {
    answer = queryPowerEfficientDecode(contentType)
    decodeAnswers.set(contentType, answer)
  }
  return answer
}

/** Starts the hardware-decode queries early. Reads only after consent. */
export function warmCodecs(): void {
  if (typeof navigator === 'undefined' || typeof navigator.mediaCapabilities?.decodingInfo !== 'function') return
  for (const type of HW_DECODE_TYPES) void isPowerEfficientDecode(type)
}

async function queryPowerEfficientDecode(contentType: string): Promise<boolean | undefined> {
  if (typeof navigator === 'undefined') return undefined
  const mc = navigator.mediaCapabilities
  if (typeof mc?.decodingInfo !== 'function') return undefined
  try {
    const info = await mc.decodingInfo({
      type: 'file',
      video: {
        contentType,
        width: 1920,
        height: 1080,
        bitrate: 4_000_000,
        framerate: 30,
      },
    })
    if (typeof info?.supported !== 'boolean') return undefined
    return info.supported && info.powerEfficient === true
  } catch {
    return undefined
  }
}

export const codecsSource: Source<CodecsSignal> = {
  id: SOURCE.codecs,
  stage: 'collect',
  // Inside the default collection budget, which the worker realm already
  // fills: a cold media stack answers late, and a missing answer changes the
  // browser's mode-invariant profile.
  timeoutMs: 320,
  async run() {
    const sender = (
      globalThis as unknown as {
        RTCRtpSender?: {
          getCapabilities?: (kind: string) => {
            codecs?: { mimeType?: string; sdpFmtpLine?: string }[]
          } | null
        }
      }
    ).RTCRtpSender

    const hasRtc = typeof sender?.getCapabilities === 'function'
    const hasMc = typeof navigator !== 'undefined' && typeof navigator.mediaCapabilities?.decodingInfo === 'function'
    if (!hasRtc && !hasMc) {
      throw new UnsupportedSignal('no-codec-capabilities')
    }

    let rtcVideo: string[] | undefined
    if (hasRtc) {
      const caps = attempt(() => sender.getCapabilities?.('video'))
      if (Array.isArray(caps?.codecs)) {
        const entries = new Set<string>()
        for (const codec of caps.codecs) {
          const mime = codec?.mimeType?.toLowerCase()
          if (!mime || REPAIR_CODECS.has(mime)) continue
          entries.add(codec.sdpFmtpLine ? `${mime}|${codec.sdpFmtpLine}` : mime)
        }
        if (entries.size > 0) rtcVideo = [...entries].sort()
      }
    }

    const [hwAv1, hwHevc10, hwVp9P2] = hasMc
      ? await Promise.all([
          isPowerEfficientDecode(HW_DECODE_TYPES[0]),
          isPowerEfficientDecode(HW_DECODE_TYPES[1]),
          isPowerEfficientDecode(HW_DECODE_TYPES[2]),
        ])
      : [undefined, undefined, undefined]

    return compact<CodecsSignal>({
      rtc_video: rtcVideo,
      hw_av1: hwAv1,
      hw_hevc10: hwHevc10,
      hw_vp9_p2: hwVp9P2,
    })
  },
}

interface ApplePayConstructor {
  canMakePayments?: () => boolean
  supportsVersion?: (version: number) => boolean
}

export const applePaySource: Source<ApplePaySignal> = {
  id: SOURCE.applePay,
  stage: 'collect',
  timeoutMs: 50,
  run() {
    const w = requireWindow()
    if (!w.isSecureContext) {
      throw new UnsupportedSignal('insecure-context')
    }
    const ApplePay = (w as Window & { ApplePaySession?: ApplePayConstructor }).ApplePaySession
    if (typeof ApplePay?.canMakePayments !== 'function') {
      throw new UnsupportedSignal('no-apple-pay')
    }

    let canMakePayments: boolean
    try {
      canMakePayments = ApplePay.canMakePayments() === true
    } catch {
      throw new BlockedSignal('apple-pay-disallowed')
    }

    let maxVersion: number | undefined
    if (typeof ApplePay.supportsVersion === 'function') {
      for (let version = 20; version >= 1; version--) {
        if (attempt(() => ApplePay.supportsVersion?.(version)) === true) {
          maxVersion = version
          break
        }
      }
    }

    return compact<ApplePaySignal>({
      can_make_payments: canMakePayments,
      max_version: maxVersion,
    })
  },
}

export const timezoneSource: Source<TimezoneSignal> = {
  id: SOURCE.timezone,
  stage: 'collect',
  run() {
    if (typeof Intl === 'undefined') throw new UnsupportedSignal('no-intl')
    return compact({
      name: attempt(() => new Intl.DateTimeFormat().resolvedOptions().timeZone),
      offset: attempt(() => new Date().getTimezoneOffset()),
    })
  },
}
