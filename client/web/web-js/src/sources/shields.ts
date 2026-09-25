/**
 * Whether the browser is actively rewriting what the other sources measure.
 *
 * This source asks Brave whether it is Brave, and checks one thing no other
 * source can see: whether canvas readback is noised. The other *effects* of
 * farbling land in signals that are already collected - the storage quota, the
 * device memory, the plugin count - and reading any of them again here would
 * only be two chances to disagree. `@fingerly/core`'s `detect/shields` does the
 * reading and the arithmetic.
 *
 * The reason to ask at all, rather than infer: Brave publishes `navigator.brave
 * .isBrave()` for sites that need to adapt to it, and an answer the browser
 * volunteers is worth having when the alternative is inferring the same fact
 * from numbers the browser is in the business of falsifying. It is also, of
 * course, removable in one line - which is why the detector treats it as one
 * vote among the behavioural tells rather than as the answer.
 */

import { SOURCE, UnsupportedSignal, type ShieldsSignal, type Source } from '@fingerly/core'

import { compact } from '../util.js'

/**
 * How long Brave's own API is given to answer.
 *
 * It resolves immediately - the value is a constant on the browser side - so
 * this deadline exists for the build that ships a `navigator.brave` whose
 * `isBrave()` never settles, which is exactly what an anti-detect browser
 * imitating Brave would leave behind. A source that hangs on one probe is a
 * source that spends the whole fast budget, and this one is not worth that.
 */
const VENDOR_API_MS = 50

interface BraveNavigator {
  brave?: { isBrave?: () => Promise<unknown> }
  userAgentData?: { brands?: { brand?: string }[] }
}

/** Distinguishes "the deadline won" from any value the promise could resolve to. */
const TIMED_OUT = Symbol('timed-out')

/**
 * `navigator.brave.isBrave()`, with a deadline.
 *
 * Undefined rather than false when the object is absent: "this browser says it
 * is not Brave" and "this browser was never asked" are different findings, and
 * only the first of them is evidence about anything.
 */
async function askBrave(nav: BraveNavigator): Promise<boolean | undefined> {
  if (typeof nav.brave?.isBrave !== 'function') return undefined

  try {
    const answer = await Promise.race([
      nav.brave.isBrave(),
      new Promise<symbol>((resolve) => setTimeout(() => resolve(TIMED_OUT), VENDOR_API_MS)),
    ])
    // A promise that never settled says nothing; a promise that resolved to
    // something other than `true` is a browser wearing the API without the
    // answer, and that is worth recording as a plain false.
    return answer === TIMED_OUT ? undefined : answer === true
  } catch {
    return undefined
  }
}

/**
 * Whether the UA-CH brand list names Brave.
 *
 * Brave adds itself to `navigator.userAgentData.brands` while leaving the
 * user-agent string byte-identical to Chrome's, so this is the only place the
 * name appears in the claimed identity. Independent of the vendor API and
 * removable separately, which is the point of collecting both: a report where
 * one is present and the other is not is more interesting than either.
 */
function claimsBrave(nav: BraveNavigator): boolean | undefined {
  const brands = nav.userAgentData?.brands
  if (!Array.isArray(brands)) return undefined
  return brands.some((entry) => entry?.brand === 'Brave')
}

/** The two colours of the canary checkerboard, as exact RGB. */
const CANARY_COLOURS = [
  [30, 60, 90],
  [210, 180, 140],
] as const

/** Eight by eight: sixty-four pixels, every one with neighbours of the other colour. */
const CANARY_SIZE = 8

/**
 * Whether canvas readback is noised, from a checkerboard whose true pixels are
 * known exactly.
 *
 * Opaque sRGB rectangles on whole pixels are drawn without antialiasing on
 * every engine, so an honest canvas reads them back byte for byte. A browser
 * that injects noise cannot leave this one alone: WebKit clamps each pixel's
 * noise to the colours around it, which spares flat areas and nothing else,
 * and here no pixel has a flat neighbourhood. One wrong byte is the answer.
 *
 * In the fast tier, unlike the canvas source, because what it protects is the
 * identity the first answer is built from. It costs one 8x8 canvas.
 */
function canvasNoise(): boolean | undefined {
  if (typeof document === 'undefined') return undefined
  try {
    const canvas = document.createElement('canvas')
    canvas.width = CANARY_SIZE
    canvas.height = CANARY_SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return undefined

    for (let y = 0; y < CANARY_SIZE; y++) {
      for (let x = 0; x < CANARY_SIZE; x++) {
        const [r, g, b] = CANARY_COLOURS[(x + y) % 2]!
        context.fillStyle = `rgb(${r}, ${g}, ${b})`
        context.fillRect(x, y, 1, 1)
      }
    }

    const pixels = context.getImageData(0, 0, CANARY_SIZE, CANARY_SIZE).data
    for (let index = 0; index < CANARY_SIZE * CANARY_SIZE; index++) {
      const x = index % CANARY_SIZE
      const y = Math.floor(index / CANARY_SIZE)
      const [r, g, b] = CANARY_COLOURS[(x + y) % 2]!
      const at = index * 4
      if (pixels[at] !== r || pixels[at + 1] !== g || pixels[at + 2] !== b || pixels[at + 3] !== 255) {
        return true
      }
    }
    return false
  } catch {
    return undefined
  }
}

export const shieldsSource: Source<ShieldsSignal> = {
  id: SOURCE.shields,
  tier: 'fast',
  timeoutMs: 100,
  async run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    const nav = navigator as Navigator & BraveNavigator

    return compact<ShieldsSignal>({
      brave: await askBrave(nav),
      brave_claimed: claimsBrave(nav),
      canvas_noise: canvasNoise(),
    })
  },
}
