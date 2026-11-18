/**
 * Countermeasures the browser applies to fingerprintable surfaces (Brave Shields
 * and canvas pixel-readback farbling), gated behind the Stage 1 Gecko RFP timer
 * check so Firefox `resistFingerprinting` / Tor Browser never displays a canvas
 * permission doorhanger (Rule #1).
 */

import {
  BlockedSignal,
  SOURCE,
  UnsupportedSignal,
  type ShieldsSignal,
  type Source,
  type SourceContext,
} from '@fingerly/core'

import { attempt, compact } from '../util.js'
import { acquireCanvas2D } from './render.js'
import { isRfpCanvasBlocked } from './runtime.js'

const VENDOR_API_MS = 50

interface BraveNavigator {
  brave?: { isBrave?: () => Promise<unknown> }
  userAgentData?: { brands?: { brand?: string }[] }
}

const TIMED_OUT = Symbol('timed-out')

type BraveApi = NonNullable<ShieldsSignal['brave_api']>

/** What `navigator.brave.isBrave()` did, as an observation (`WEB-02`). */
async function askBrave(nav: BraveNavigator): Promise<BraveApi> {
  const brave = attempt(() => nav.brave)
  if (brave === undefined || brave === null) return 'absent'
  const isBrave = attempt(() => brave.isBrave)
  if (typeof isBrave !== 'function') return 'not-function'

  try {
    const answer = await Promise.race([
      isBrave.call(brave),
      new Promise<symbol>((resolve) => setTimeout(() => resolve(TIMED_OUT), VENDOR_API_MS)),
    ])
    if (answer === TIMED_OUT) return 'timeout'
    return answer === true ? 'true' : 'false'
  } catch {
    return 'threw'
  }
}

/** The brand names the browser lists, in order (`WEB-02`). */
function brandsOf(nav: BraveNavigator): string[] | undefined {
  const brands = attempt(() => nav.userAgentData?.brands)
  if (!Array.isArray(brands)) return undefined
  return brands
    .map((entry) => attempt(() => entry?.brand))
    .filter((brand): brand is string => typeof brand === 'string')
}

const CANARY_COLOURS = [
  [30, 60, 90],
  [210, 180, 140],
] as const

const CANARY_SIZE = 8

/**
 * The canary readback compared with what was drawn: how many pixels came back
 * different and by how much. The page's `canvas_noise` boolean is derived
 * from these, and they go on the wire with it so the server can derive it
 * too (`WEB-02`).
 */
interface CanaryReading {
  pixels: number
  mismatched: number
  maxDelta: number
}

function readCanary(ctx: SourceContext | undefined): CanaryReading | undefined {
  if (typeof document === 'undefined') return undefined
  try {
    const pair = acquireCanvas2D(ctx, CANARY_SIZE, CANARY_SIZE)
    if (!pair) return undefined
    const [, context] = pair

    for (let y = 0; y < CANARY_SIZE; y++) {
      for (let x = 0; x < CANARY_SIZE; x++) {
        const [r, g, b] = CANARY_COLOURS[(x + y) % 2]!
        context.fillStyle = `rgb(${r}, ${g}, ${b})`
        context.fillRect(x, y, 1, 1)
      }
    }

    const pixels = context.getImageData(0, 0, CANARY_SIZE, CANARY_SIZE).data
    let mismatched = 0
    let maxDelta = 0
    const total = CANARY_SIZE * CANARY_SIZE
    for (let index = 0; index < total; index++) {
      const x = index % CANARY_SIZE
      const y = Math.floor(index / CANARY_SIZE)
      const [r, g, b] = CANARY_COLOURS[(x + y) % 2]!
      const at = index * 4
      const deltas = [
        Math.abs((pixels[at] ?? 0) - r),
        Math.abs((pixels[at + 1] ?? 0) - g),
        Math.abs((pixels[at + 2] ?? 0) - b),
        Math.abs((pixels[at + 3] ?? 0) - 255),
      ]
      const worst = Math.max(...deltas)
      if (worst > 0) mismatched += 1
      if (worst > maxDelta) maxDelta = worst
    }
    return { pixels: total, mismatched, maxDelta }
  } catch {
    return undefined
  }
}

export const shieldsSource: Source<ShieldsSignal> = {
  id: SOURCE.shields,
  stage: 'collect',
  identityCritical: true,
  timeoutMs: 100,
  async run(ctx) {
    if (isRfpCanvasBlocked(ctx)) {
      throw new BlockedSignal('rfp-canvas-prompt-avoided')
    }

    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    const nav = navigator as Navigator & BraveNavigator

    const braveApi = await askBrave(nav)
    const brands = brandsOf(nav)
    const canary = readCanary(ctx)

    // The three booleans are the page's reading; the fields after them are
    // the observations behind each one (`WEB-02`).
    return compact<ShieldsSignal>({
      brave: braveApi === 'true' ? true : braveApi === 'false' ? false : undefined,
      brave_claimed: brands === undefined ? undefined : brands.includes('Brave'),
      canvas_noise: canary === undefined ? undefined : canary.mismatched > 0,
      brave_api: braveApi,
      brands,
      canary_pixels: canary?.pixels,
      canary_mismatched: canary?.mismatched,
      canary_max_delta: canary?.maxDelta,
    })
  },
}
