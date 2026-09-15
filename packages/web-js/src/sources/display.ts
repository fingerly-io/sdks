/**
 * Screen geometry, window chrome, and the `matchMedia` family.
 *
 * The media-query family is the one idea another library has that is genuinely
 * under-appreciated: eight independent signals, all synchronous, none behind a
 * permission, describing display capability and accessibility configuration
 * that nothing else in the browser exposes. Taken here, and extended.
 */

import {
  SOURCE,
  UnsupportedSignal,
  type ColorGamutSignal,
  type MediaQueriesSignal,
  type ScreenFrameSignal,
  type ScreenSignal,
  type Source,
} from '@badele/core'

import { attempt, compact, requireWindow } from '../util.js'

export const screenSource: Source<ScreenSignal> = {
  id: SOURCE.screen,
  tier: 'fast',
  run() {
    const w = requireWindow()
    // `availTop` and `availLeft` are not in the standard `Screen` interface -
    // Firefox and WebKit expose them, Chromium does not - and their absence is
    // as much a signal as their value, so they are read through a widened type
    // rather than skipped.
    const s = w.screen as Screen & { availTop?: number; availLeft?: number }

    return compact<ScreenSignal>({
      width: attempt(() => s.width),
      height: attempt(() => s.height),
      avail_width: attempt(() => s.availWidth),
      avail_height: attempt(() => s.availHeight),
      color_depth: attempt(() => s.colorDepth),
      pixel_depth: attempt(() => s.pixelDepth),
      device_pixel_ratio: attempt(() => w.devicePixelRatio),
      orientation: attempt(() => s.orientation?.type),
      inner_width: attempt(() => w.innerWidth),
      inner_height: attempt(() => w.innerHeight),
      // Window chrome insets. Zero on every side while fullscreen, which is
      // why the tuple is kept rather than reduced to a boolean - a fullscreen
      // window and a chromeless one are different, and the zeroes say which.
      frame: attempt(() => [
        s.availTop ?? null,
        (s.width ?? 0) - (s.availWidth ?? 0) - (s.availLeft ?? 0),
        (s.height ?? 0) - (s.availHeight ?? 0) - (s.availTop ?? 0),
        s.availLeft ?? null,
      ]),
    })
  },
}

let lastUsableFrame: (number | null)[] | undefined

function readFrame(w: Window): (number | null)[] {
  const s = w.screen as Screen & { availTop?: number; availLeft?: number }
  return [
    s.availTop ?? null,
    (s.width ?? 0) - (s.availWidth ?? 0) - (s.availLeft ?? 0),
    (s.height ?? 0) - (s.availHeight ?? 0) - (s.availTop ?? 0),
    s.availLeft ?? null,
  ]
}

export const screenFrameSource: Source<ScreenFrameSignal> = {
  id: SOURCE.screenFrame,
  tier: 'fast',
  run() {
    const w = requireWindow()
    const frame = readFrame(w)
    const fullscreen = w.document?.fullscreenElement != null
    const allZero = frame.every((value) => value === 0 || value === null)
    if (!fullscreen && !allZero) lastUsableFrame = frame
    return { frame: fullscreen && lastUsableFrame ? [...lastUsableFrame] : frame }
  },
}

/**
 * Binary-search a media feature that takes a numeric value.
 *
 * `monochrome` and `color-gamut` cannot be read; they can only be asked
 * yes/no questions. Bounded iteration rather than a loop to a condition,
 * because this runs inside a budget and a browser that answers inconsistently
 * must not be able to spin here.
 */
function matchRange(w: Window, feature: string, max: number): number | undefined {
  if (typeof w.matchMedia !== 'function') return undefined
  for (let value = 0; value <= max; value++) {
    if (w.matchMedia(`(${feature}: ${value})`).matches) return value
  }
  return undefined
}

function matchFirst(w: Window, queries: string[]): string | undefined {
  if (typeof w.matchMedia !== 'function') return undefined
  return queries.find((query) => w.matchMedia(query).matches)
}

export const mediaQueriesSource: Source<MediaQueriesSignal> = {
  id: SOURCE.mediaQueries,
  tier: 'fast',
  run() {
    const w = requireWindow()
    if (typeof w.matchMedia !== 'function') throw new UnsupportedSignal('no-match-media')

    const gamut = matchFirst(w, [
      '(color-gamut: rec2020)',
      '(color-gamut: p3)',
      '(color-gamut: srgb)',
    ])

    const contrast = matchFirst(w, [
      '(prefers-contrast: more)',
      '(prefers-contrast: less)',
      '(prefers-contrast: custom)',
      '(prefers-contrast: no-preference)',
    ])

    return compact<MediaQueriesSignal>({
      color_gamut: gamut?.match(/color-gamut:\s*(\w+)/)?.[1],
      inverted_colors: attempt(() => w.matchMedia('(inverted-colors: inverted)').matches),
      forced_colors: attempt(() => w.matchMedia('(forced-colors: active)').matches),
      monochrome: matchRange(w, 'monochrome', 10),
      contrast: contrast?.match(/prefers-contrast:\s*([\w-]+)/)?.[1],
      reduced_motion: attempt(() => w.matchMedia('(prefers-reduced-motion: reduce)').matches),
      reduced_transparency: attempt(
        () => w.matchMedia('(prefers-reduced-transparency: reduce)').matches,
      ),
      hdr: attempt(() => w.matchMedia('(dynamic-range: high)').matches),
    })
  },
}

export const colorGamutSource: Source<ColorGamutSignal> = {
  id: SOURCE.colorGamut,
  tier: 'fast',
  run() {
    const w = requireWindow()
    if (typeof w.matchMedia !== 'function') throw new UnsupportedSignal('no-match-media')
    const query = matchFirst(w, [
      '(color-gamut: rec2020)',
      '(color-gamut: p3)',
      '(color-gamut: srgb)',
    ])
    const gamut = query?.match(/color-gamut:\s*(\w+)/)?.[1]
    return gamut === 'srgb' || gamut === 'p3' || gamut === 'rec2020' ? { gamut } : {}
  },
}
