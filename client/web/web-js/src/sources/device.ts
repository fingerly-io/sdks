/**
 * Device capability: input, sensors, media hardware, network, locale.
 *
 * Individually these are low-entropy. Their value is in contradicting each
 * other - a user-agent claiming a phone while the pointer is fine, hover works
 * and no accelerometer exists is an emulator, and no single one of those three
 * says so on its own.
 */

import {
  SOURCE,
  UnsupportedSignal,
  type HardwareSignal,
  type IntlSignal,
  type BatterySignal,
  type MediaDevicesSignal,
  type NetworkSignal,
  type SensorsSignal,
  type Source,
  type SpeechSignal,
  type TouchSignal,
  type TimezoneSignal,
} from '@fingerly/core'

import { attempt, compact, requireWindow } from '../util.js'

export const hardwareSource: Source<HardwareSignal> = {
  id: SOURCE.hardware,
  tier: 'fast',
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
  tier: 'fast',
  run() {
    const w = requireWindow()

    return compact<TouchSignal>({
      max_touch_points: attempt(() => navigator.maxTouchPoints),
      touch_event: attempt(() => 'ontouchstart' in w),
      touch_start: attempt(() => {
        // Constructing the event rather than sniffing for the constructor: a
        // spoofer that adds `ontouchstart` to window rarely also makes
        // TouchEvent constructible, and the two disagreeing is the signal.
        document.createEvent('TouchEvent')
        return true
      }),
      pointer_coarse: attempt(() => w.matchMedia?.('(pointer: coarse)').matches),
      any_hover: attempt(() => w.matchMedia?.('(any-hover: hover)').matches),
      // Presence only, and in the fast tier for that reason: the deferred
      // `sensors` source is what waits to see whether an event fires. This is
      // what the server's mobile-UA-with-no-motion-sensors rule reads.
      device_motion: attempt(() => 'DeviceMotionEvent' in w),
      device_orientation: attempt(() => 'DeviceOrientationEvent' in w),
    })
  },
}

/**
 * Motion sensors.
 *
 * Presence of the event interfaces is checked synchronously; whether one
 * actually *fires* is checked over a short window, because an emulator
 * frequently exposes the API and never delivers an event. iOS needs a user
 * gesture to grant motion access, so a `false` here is not conclusive on its
 * own - which is why the emulator detector requires the mobile user-agent
 * alongside it.
 */
export const sensorsSource: Source<SensorsSignal> = {
  id: SOURCE.sensors,
  tier: 'deferred',
  // 150ms, not the 250 this started at. A real accelerometer delivers
  // `devicemotion` at 60Hz, so anything past the first few frames is waiting
  // for an event that is not coming.
  timeoutMs: 150,
  async run(ctx) {
    const w = requireWindow()

    const hasMotion = 'DeviceMotionEvent' in w
    const hasOrientation = 'DeviceOrientationEvent' in w

    if (!hasMotion && !hasOrientation) {
      return compact<SensorsSignal>({ device_motion: false, device_orientation: false })
    }

    // Do not wait for an event in a hidden tab.
    //
    // This is the single most expensive decision in the source set, and it was
    // found by measurement rather than reasoning. Chrome throttles timers in a
    // background tab - a bare `setTimeout(100)` was observed taking 233ms and,
    // later in the same session, 794ms - and this is the one source whose cost
    // is a timer wait rather than computation. It alone accounted for 885ms of
    // a 1007ms run while every compute-bound source stayed under 130ms.
    //
    // Waiting buys nothing there either: a hidden tab receives no motion
    // events, so the answer after 100 throttled milliseconds is the same `false`
    // it would have been immediately - except now it is indistinguishable from a
    // device that genuinely has no accelerometer. `motion_observed` is left
    // absent instead, which is the honest answer: not measured.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return compact<SensorsSignal>({
        device_motion: hasMotion,
        device_orientation: hasOrientation,
      })
    }

    const observed = await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        w.removeEventListener('devicemotion', onMotion)
        clearTimeout(timer)
        resolve(value)
      }
      const onMotion = () => finish(true)

      const timer = setTimeout(() => finish(false), 100)
      ctx.signal.addEventListener('abort', () => finish(false), { once: true })
      w.addEventListener('devicemotion', onMotion, { once: true })
    })

    return compact<SensorsSignal>({
      device_motion: hasMotion,
      device_orientation: hasOrientation,
      motion_observed: observed,
    })
  },
}

/**
 * Attached media hardware, by count.
 *
 * Counts only - no labels, which need a granted permission and would be
 * personal data this service has no business collecting. A device with no
 * microphone, no speaker and no camera at all is the interesting case: almost
 * every real phone and laptop has at least one, and a rack of them often has
 * none.
 *
 * In the fast tier, because the score is built from the first submission and
 * the device-farm rule needs this reading. `enumerateDevices` is an IPC answer
 * with no permission prompt and no main-thread work; its cap is what keeps a
 * device that answers slowly from costing the identification more than that.
 */
export const mediaDevicesSource: Source<MediaDevicesSignal> = {
  id: SOURCE.mediaDevices,
  tier: 'fast',
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
  tier: 'fast',
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
  tier: 'fast',
  run() {
    if (typeof Intl === 'undefined') throw new UnsupportedSignal('no-intl')

    const resolved = attempt(() => new Intl.DateTimeFormat().resolvedOptions())

    return compact<IntlSignal>({
      timezone: resolved?.timeZone,
      // Kept alongside the zone name because resistFingerprinting reports UTC
      // for both, while an ordinary browser in London reports Europe/London
      // with the same zero offset in winter. The pair separates them.
      timezone_offset: attempt(() => new Date().getTimezoneOffset()),
      locale: resolved?.locale,
      calendar: resolved?.calendar,
      numbering_system: resolved?.numberingSystem,
      // A fixed instant formatted in the visitor's locale. Catches differences
      // in the ICU data the browser was built with, which the locale name alone
      // does not.
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
  tier: 'fast',
  run() {
    if (typeof Intl === 'undefined') throw new UnsupportedSignal('no-intl')
    return compact({
      name: attempt(() => new Intl.DateTimeFormat().resolvedOptions().timeZone),
      offset: attempt(() => new Date().getTimezoneOffset()),
    })
  },
}

interface BatteryManagerLike {
  charging?: boolean
  chargingTime?: number
  dischargingTime?: number
  level?: number
}

export const batterySource: Source<BatterySignal> = {
  id: SOURCE.battery,
  tier: 'deferred',
  timeoutMs: 250,
  async run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    const getBattery = (navigator as Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>
    }).getBattery
    if (typeof getBattery !== 'function') throw new UnsupportedSignal('no-battery-api')
    const battery = await getBattery.call(navigator)
    const finiteOrNull = (value: number | undefined): number | null | undefined =>
      value === undefined ? undefined : Number.isFinite(value) ? value : null
    return compact<BatterySignal>({
      charging: battery.charging,
      charging_time: finiteOrNull(battery.chargingTime),
      discharging_time: finiteOrNull(battery.dischargingTime),
      level: battery.level,
    })
  },
}

export const speechSource: Source<SpeechSignal> = {
  id: SOURCE.speech,
  tier: 'deferred',
  timeoutMs: 250,
  async run(ctx) {
    if (typeof speechSynthesis === 'undefined') throw new UnsupportedSignal('no-speech-synthesis')

    let voices = speechSynthesis.getVoices()
    if (voices.length === 0) {
      voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const finish = () => {
          speechSynthesis.removeEventListener('voiceschanged', changed)
          ctx.signal.removeEventListener('abort', aborted)
          resolve(speechSynthesis.getVoices())
        }
        const changed = () => finish()
        const aborted = () => finish()
        speechSynthesis.addEventListener('voiceschanged', changed, { once: true })
        ctx.signal.addEventListener('abort', aborted, { once: true })
        setTimeout(finish, Math.min(100, ctx.budgetRemainingMs()))
      })
    }

    return {
      voices: voices.map((voice) => ({
        name: voice.name,
        language: voice.lang,
        local_service: voice.localService,
        default: voice.default,
        uri: voice.voiceURI,
      })),
    }
  },
}
