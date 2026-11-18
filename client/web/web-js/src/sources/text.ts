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
  type SourceContext,
  type VoicesSignal,
} from '@fingerly/core'

import { attempt, compact } from '../util.js'

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
  stage: 'collect',
  // Mandatory for recognising a Safari private window, and fast, so it runs
  // ahead of the slow sources: on a real HTTPS page Safari's Apple Pay check
  // takes about 400 ms, and with five other slow sources it filled every
  // worker until the budget was gone, so the fonts never started.
  identityCritical: true,
  // Generous: this measures ~300 spans, and forcing layout on a busy page is
  // genuinely slow. Still bounded, which is the part that matters.
  timeoutMs: 250,
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
  stage: 'collect',
  // Mandatory for recognising a Safari private window; see the fonts source.
  identityCritical: true,
  // Inside the default collection budget: a cold page builds its first
  // measuring frame slowly.
  timeoutMs: 320,
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
      // A 1px probe detects Safari's "Never use font sizes smaller than N"
      // accessibility setting, which clamps small sizes while leaving 72px untouched.
      const tiny = doc.createElement('span')
      tiny.textContent = text
      tiny.style.cssText = 'font:1px sans-serif;white-space:nowrap;position:absolute'
      doc.body.appendChild(tiny)
      widths.tiny = Math.round(tiny.getBoundingClientRect().width * 1000) / 1000
      return { widths }
    } finally {
      frame.remove()
    }
  },
}

const MAX_VOICES = 256
// The first `getVoices()` after the browser starts can come back empty while
// the system speech service starts; [warmVoices] asks early, and the source
// waits out the rest of the default collection budget for the list.
const VOICES_WAIT_MS = 200
// WebKit only: the voice list is what a Safari private window is recognised
// by, so a cold WebKit waits into the grace period for it. Other engines do
// not need it, and some never have voices: waiting there would only be slow.
const WEBKIT_VOICES_WAIT_MS = 560

function observedWebKit(ctx: SourceContext | undefined): boolean {
  const engine = attempt(() => ctx?.completed?.(SOURCE.engine))
  const value = engine?.status === 'ok' ? (engine.value as { observed?: unknown } | undefined) : undefined
  return value?.observed === 'webkit'
}
const VOICES_POLL_MS = 25

function readVoiceSnapshot(synth: SpeechSynthesis): VoicesSignal {
  const raw = attempt(() => synth.getVoices())
  if (!Array.isArray(raw) || raw.length === 0) return {}

  const entries = new Set<string>()
  let defaultVoice: string | undefined

  for (const voice of raw) {
    if (entries.size >= MAX_VOICES) break
    const name = attempt(() => voice.name?.trim())
    const lang = attempt(() => voice.lang?.trim())
    if (!name || !lang) continue
    const local = attempt(() => voice.localService) === true ? '1' : '0'
    entries.add(`${name}|${lang}|${local}`)
    if (defaultVoice === undefined && attempt(() => voice.default) === true) {
      defaultVoice = `${name}|${lang}`
    }
  }

  if (entries.size === 0) return {}
  return compact<VoicesSignal>({
    voices: [...entries].sort(),
    default_voice: defaultVoice,
  })
}

/** Asks for the voice list early, so it is loaded by collection. Reads only after consent. */
export function warmVoices(): void {
  attempt(() => (typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : undefined))
}

/**
 * OS speech synthesis voices (`speechSynthesis.getVoices()`).
 *
 * Identical across Safari Normal and Private Browsing unless Safari's
 * `ScriptTrackingPrivacyCategory::Speech` withholds the list (`[]`), in which
 * case an empty object is returned so the server treats the voice family as
 * absent rather than hashing emptiness.
 */
export const voicesSource: Source<VoicesSignal> = {
  id: SOURCE.voices,
  stage: 'collect',
  // Mandatory for recognising a Safari private window: it may run into the
  // scheduler's grace period on a cold start.
  identityCritical: true,
  timeoutMs: 600,
  async run(ctx: SourceContext) {
    const synth = attempt(() =>
      typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined,
    )
    if (!synth || typeof synth.getVoices !== 'function') {
      throw new UnsupportedSignal('no-speech-synthesis')
    }

    const immediate = readVoiceSnapshot(synth)
    if (immediate.voices && immediate.voices.length > 0) return immediate

    const wantMs = observedWebKit(ctx) ? WEBKIT_VOICES_WAIT_MS : VOICES_WAIT_MS
    const waitMs = Math.max(0, Math.min(wantMs, ctx?.budgetRemainingMs?.() ?? wantMs))
    if (waitMs === 0) return {}

    // WebKit frequently populates speechSynthesis.getVoices() asynchronously
    // after the first call without dispatching `voiceschanged`, so poll lightly
    // alongside the event listener and settle as soon as voices appear.
    let polled: VoicesSignal = {}
    await new Promise<void>((resolve) => {
      let settled = false
      let pollTimer: ReturnType<typeof setInterval> | undefined
      const finish = () => {
        if (settled) return
        settled = true
        if (pollTimer !== undefined) clearInterval(pollTimer)
        clearTimeout(timer)
        attempt(() => synth.removeEventListener?.('voiceschanged', finish))
        resolve()
      }
      const timer = setTimeout(finish, waitMs)
      pollTimer = setInterval(() => {
        const snap = readVoiceSnapshot(synth)
        if (snap.voices && snap.voices.length > 0) {
          polled = snap
          finish()
        }
      }, VOICES_POLL_MS)
      ctx?.signal?.addEventListener('abort', finish, { once: true })
      attempt(() => synth.addEventListener?.('voiceschanged', finish, { once: true }))
    })

    return polled.voices && polled.voices.length > 0 ? polled : readVoiceSnapshot(synth)
  },
}
