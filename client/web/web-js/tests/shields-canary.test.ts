// @vitest-environment happy-dom
import { BlockedSignal, SOURCE, type SourceContext } from '@fingerly/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canvasSource } from '../src/sources/render.js'
import { shieldsSource } from '../src/sources/shields.js'

function fakeCanvas(noise?: (value: number, index: number) => number) {
  return () => {
    let width = 0
    let height = 0
    let pixels = new Uint8ClampedArray(0)
    const context = {
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      font: '',
      textBaseline: 'alphabetic',
      fillRect(x: number, y: number, w: number, h: number) {
        const [r = 0, g = 0, b = 0] = (context.fillStyle.match(/\d+/g) ?? []).map(Number)
        for (let yy = y; yy < y + h; yy++) {
          for (let xx = x; xx < x + w; xx++) {
            const at = (yy * width + xx) * 4
            if (at + 3 < pixels.length) {
              pixels.set([r, g, b, 255], at)
            }
          }
        }
      },
      fillText() {},
      beginPath() {},
      arc() {},
      closePath() {},
      fill() {},
      rect() {},
      isPointInPath: () => false,
      getImageData(_x: number, _y: number, w: number, h: number) {
        const data = Uint8ClampedArray.from(pixels.slice(0, w * h * 4), (value, index) =>
          noise ? noise(value, index) : value,
        )
        return { data }
      },
    }
    return {
      get width() {
        return width
      },
      set width(value: number) {
        width = value
        pixels = new Uint8ClampedArray(width * height * 4)
      },
      get height() {
        return height
      },
      set height(value: number) {
        height = value
        pixels = new Uint8ClampedArray(width * height * 4)
      },
      getContext: () => context,
    }
  }
}

function withCanvas(factory: () => unknown) {
  const original = document.createElement.bind(document)
  return vi
    .spyOn(document, 'createElement')
    .mockImplementation(((tag: string) =>
      tag === 'canvas' ? factory() : original(tag)) as typeof document.createElement)
}

afterEach(() => vi.restoreAllMocks())

describe('canvas noise canary & shared 2D context', () => {
  it('reads an honest canvas back exactly', async () => {
    withCanvas(fakeCanvas())
    expect((await shieldsSource.run({} as never)).canvas_noise).toBe(false)
  })

  it('notices a single byte of noise, as a per-page seeded browser adds it', async () => {
    withCanvas(fakeCanvas((value, index) => (index === 41 ? value + 1 : value)))
    expect((await shieldsSource.run({} as never)).canvas_noise).toBe(true)
  })

  it('says nothing when there is no canvas to ask', async () => {
    withCanvas(() => ({ width: 0, height: 0, getContext: () => null }))
    expect((await shieldsSource.run({} as never)).canvas_noise).toBeUndefined()
  })

  it('shares one offscreen <canvas> 2D context across shieldsSource and canvasSource via ctx.shared', async () => {
    const createElementSpy = withCanvas(fakeCanvas())
    const shared = new Map<string, unknown>()
    const ctx: SourceContext = {
      signal: new AbortController().signal,
      budgetRemainingMs: () => 350,
      completed: (id) =>
        id === SOURCE.timing
          ? {
              status: 'ok',
              ms: 0,
              value: { has_performance: true, now_resolution: 0, rfp_canvas_blocked: false },
            }
          : undefined,
      shared,
    }

    const shields = await shieldsSource.run(ctx)
    const canvas = await canvasSource.run(ctx)

    expect(shields.canvas_noise).toBe(false)
    expect(canvas.geometry).toMatch(/^[0-9a-f]{16}$/)
    expect(canvas.text).toMatch(/^[0-9a-f]{16}$/)
    expect(canvas.unstable).toBe(false)
    expect(createElementSpy).toHaveBeenCalledTimes(1)
  })

  it('blocks shieldsSource before creating any canvas when rfp_canvas_blocked is true', async () => {
    const createElementSpy = withCanvas(fakeCanvas())
    const ctx: SourceContext = {
      signal: new AbortController().signal,
      budgetRemainingMs: () => 350,
      completed: (id) =>
        id === SOURCE.timing
          ? {
              status: 'ok',
              ms: 2,
              value: { has_performance: true, now_resolution: 16.67, rfp_canvas_blocked: true },
            }
          : undefined,
      shared: new Map(),
    }

    await expect(shieldsSource.run(ctx)).rejects.toEqual(
      expect.objectContaining<Partial<BlockedSignal>>({
        name: 'BlockedSignal',
        reason: 'rfp-canvas-prompt-avoided',
      }),
    )
    expect(createElementSpy).not.toHaveBeenCalled()
  })
})
