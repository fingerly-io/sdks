/**
 * Device capability: hardware concurrency/memory, touch/motion interface presence,
 * attached media device counts, network hints, and locale/timezone.
 */

import {
  SOURCE,
  UnsupportedSignal,
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

    return compact<IntlSignal>({
      timezone: resolved?.timeZone,
      timezone_offset: attempt(() => new Date().getTimezoneOffset()),
      locale: resolved?.locale,
      calendar: resolved?.calendar,
      numbering_system: resolved?.numberingSystem,
      formatted: attempt(() =>
        new Intl.DateTimeFormat(undefined, {
          dateStyle: 'full',
          timeStyle: 'full',
        }).format(new Date(0)),
      ),
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
