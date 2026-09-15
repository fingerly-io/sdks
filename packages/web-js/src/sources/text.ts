/**
 * Which fonts are installed, measured rather than enumerated.
 *
 * `navigator.fonts` does not exist and the Local Font Access API needs a
 * permission nobody grants, so availability is inferred: render a string in a
 * candidate font with a known fallback behind it, and see whether the measured
 * width moved. If it did, the candidate resolved to something real.
 *
 * The font set is one of the strongest signals there is - it reflects the
 * operating system, its language packs, and every application the user has
 * installed - and it is also a good farm tell, because a freshly imaged device
 * has only the platform defaults.
 */

import {
  SOURCE,
  UnsupportedSignal,
  type FontPreferencesSignal,
  type FontsSignal,
  type Source,
} from '@badele/core'

import { compact } from '../util.js'

/**
 * The fallbacks. A candidate is present if it measures differently from *all*
 * three, because a candidate that happens to match one base by coincidence
 * would otherwise be missed.
 */
const BASE_FONTS = ['monospace', 'sans-serif', 'serif'] as const

/** Large enough that a one-pixel per-glyph difference is unmissable. */
const TEST_SIZE = '72px'

/**
 * Characters chosen to differ widely between typefaces - mixed case, digits,
 * and the letters whose widths vary most between families.
 */
const TEST_STRING = 'mmmmmmmmmmlli WwMmIi 0123'

/**
 * The candidates.
 *
 * Deliberately a fixed, ordered list. The set has to be identical on every
 * device forever or the results are not comparable, and it has to stay short
 * enough to measure inside a budget. These are the families that most divide
 * the population: platform defaults that identify the OS, and bundled fonts
 * that identify an installed application.
 */
const CANDIDATES = [
  // Windows
  'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS',
  'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic',
  'Gabriola', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
  'Malgun Gothic', 'Marlett', 'Microsoft Himalaya', 'MS Gothic', 'MV Boli',
  'Nirmala UI', 'Palatino Linotype', 'Segoe UI', 'Segoe UI Emoji', 'Sylfaen',
  'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings',
  // macOS / iOS
  'American Typewriter', 'Andale Mono', 'Apple Chancery', 'Arial Hebrew',
  'Avenir', 'Avenir Next', 'Baskerville', 'Big Caslon', 'Bodoni 72', 'Chalkboard',
  'Cochin', 'Copperplate', 'Didot', 'Futura', 'Geneva', 'Gill Sans', 'Helvetica',
  'Helvetica Neue', 'Herculanum', 'Hoefler Text', 'Lucida Grande', 'Luminari',
  'Menlo', 'Monaco', 'Optima', 'Papyrus', 'Phosphate', 'Rockwell', 'SF Pro',
  'Skia', 'Snell Roundhand', 'Trattatello', 'Zapfino',
  // Linux
  'Cantarell', 'DejaVu Sans', 'DejaVu Serif', 'FreeSans', 'Liberation Sans',
  'Liberation Serif', 'Nimbus Sans', 'Noto Sans', 'Ubuntu', 'Ubuntu Mono',
  // Android
  'Droid Sans', 'Roboto', 'Roboto Condensed',
  // Bundled with common applications - each one names an installed product
  'Bahnschrift', 'Bookshelf Symbol 7', 'Cascadia Code', 'Fira Code',
  'HoloLens MDL2 Assets', 'Inter', 'JetBrains Mono', 'MT Extra',
  'Source Code Pro', 'Wingdings 2', 'Wingdings 3',
] as const

export const fontsSource: Source<FontsSignal> = {
  id: SOURCE.fonts,
  tier: 'deferred',
  // Generous: this measures ~300 spans, and forcing layout on a busy page is
  // genuinely slow. Still bounded, which is the part that matters.
  timeoutMs: 700,
  run() {
    if (typeof document === 'undefined') throw new UnsupportedSignal('no-document')

    // Everything happens inside one detached container that is appended once
    // and removed once. Appending per candidate would force ~300 separate
    // layouts and turn a 40ms source into a 2-second one.
    const holder = document.createElement('div')
    holder.style.cssText =
      'position:absolute;left:-9999px;top:-9999px;visibility:hidden;' +
      'width:auto;height:auto;margin:0;padding:0;white-space:nowrap;'

    const span = (fontFamily: string): HTMLSpanElement => {
      const element = document.createElement('span')
      element.style.cssText = `position:absolute;font-size:${TEST_SIZE};margin:0;padding:0;font-family:${fontFamily};`
      element.textContent = TEST_STRING
      holder.appendChild(element)
      return element
    }

    const baseSpans = BASE_FONTS.map((base) => span(base))
    const candidateSpans = CANDIDATES.map((candidate) =>
      BASE_FONTS.map((base) => span(`'${candidate}',${base}`)),
    )

    document.body.appendChild(holder)

    try {
      // Read every width in one pass, after a single layout.
      const baseWidths = baseSpans.map((element) => element.offsetWidth)
      const baseHeights = baseSpans.map((element) => element.offsetHeight)

      const available: string[] = []

      CANDIDATES.forEach((candidate, index) => {
        const spans = candidateSpans[index]
        if (!spans) return

        // Present if it differs from *every* base. Differing from only one is
        // how a candidate that happens to share metrics with `serif` gets
        // reported as installed when it is not.
        const differs = spans.every((element, baseIndex) => {
          const width = baseWidths[baseIndex]
          const height = baseHeights[baseIndex]
          return element.offsetWidth !== width || element.offsetHeight !== height
        })

        if (differs) available.push(candidate)
      })

      return compact<FontsSignal>({
        available,
        // The denominator, so a consumer reads a ratio rather than a count -
        // and so that adding a candidate later does not silently change what
        // "12 fonts" meant in a stored report.
        probed: CANDIDATES.length,
      })
    } finally {
      holder.remove()
    }
  },
}

export const fontPreferencesSource: Source<FontPreferencesSignal> = {
  id: SOURCE.fontPreferences,
  tier: 'deferred',
  timeoutMs: 250,
  run() {
    if (typeof document === 'undefined' || !document.body) {
      throw new UnsupportedSignal('no-document-body')
    }

    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;border:0'
    document.body.appendChild(frame)
    try {
      const doc = frame.contentDocument
      if (!doc?.body) throw new UnsupportedSignal('no-frame-document')
      const text = 'mmMwWLliI0O&1'
      const families: Record<string, string> = {
        default: '',
        serif: 'serif',
        sans: 'sans-serif',
        mono: 'monospace',
        system: 'system-ui',
        apple: '-apple-system',
        min: 'Arial, sans-serif',
      }
      const widths: Record<string, number> = {}
      for (const [name, family] of Object.entries(families)) {
        const span = doc.createElement('span')
        span.textContent = text
        span.style.cssText = `font:72px ${family || 'initial'};white-space:nowrap;position:absolute`
        doc.body.appendChild(span)
        widths[name] = Math.round(span.getBoundingClientRect().width * 1000) / 1000
      }
      return { widths }
    } finally {
      frame.remove()
    }
  },
}
