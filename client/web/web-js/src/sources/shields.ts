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

import { compact } from '../util.js'
import { acquireCanvas2D } from './render.js'
import { isRfpCanvasBlocked } from './runtime.js'

const VENDOR_API_MS = 50

interface BraveNavigator {
  brave?: { isBrave?: () => Promise<unknown> }
  userAgentData?: { brands?: { brand?: string }[] }
}

const TIMED_OUT = Symbol('timed-out')

async function askBrave(nav: BraveNavigator): Promise<boolean | undefined> {
  if (typeof nav.brave?.isBrave !== 'function') return undefined

  try {
    const answer = await Promise.race([
      nav.brave.isBrave(),
      new Promise<symbol>((resolve) => setTimeout(() => resolve(TIMED_OUT), VENDOR_API_MS)),
    ])
    return answer === TIMED_OUT ? undefined : answer === true
  } catch {
    return undefined
  }
}

function claimsBrave(nav: BraveNavigator): boolean | undefined {
  const brands = nav.userAgentData?.brands
  if (!Array.isArray(brands)) return undefined
  return brands.some((entry) => entry?.brand === 'Brave')
}

const CANARY_COLOURS = [
  [30, 60, 90],
  [210, 180, 140],
] as const

const CANARY_SIZE = 8

function canvasNoise(ctx: SourceContext | undefined): boolean | undefined {
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
    for (let index = 0; index < CANARY_SIZE * CANARY_SIZE; index++) {
      const x = index % CANARY_SIZE
      const y = Math.floor(index / CANARY_SIZE)
      const [r, g, b] = CANARY_COLOURS[(x + y) % 2]!
      const at = index * 4
      if (
        pixels[at] !== r ||
        pixels[at + 1] !== g ||
        pixels[at + 2] !== b ||
        pixels[at + 3] !== 255
      ) {
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
  stage: 'collect',
  timeoutMs: 100,
  async run(ctx) {
    if (isRfpCanvasBlocked(ctx)) {
      throw new BlockedSignal('rfp-canvas-prompt-avoided')
    }

    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    const nav = navigator as Navigator & BraveNavigator

    return compact<ShieldsSignal>({
      brave: await askBrave(nav),
      brave_claimed: claimsBrave(nav),
      canvas_noise: canvasNoise(ctx),
    })
  },
}
