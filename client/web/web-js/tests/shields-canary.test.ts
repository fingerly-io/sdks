// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shieldsSource } from '../src/sources/shields.js'

/**
 * A 2D canvas in memory: fillRect on whole pixels, getImageData back, and an
 * optional noise function standing in for a browser's readback protection.
 */
function fakeCanvas(noise?: (value: number, index: number) => number) {
  return () => {
    let width = 0
    let height = 0
    let pixels = new Uint8ClampedArray(0)
    const context = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) {
        const [r, g, b] = (context.fillStyle.match(/\d+/g) ?? []).map(Number)
        for (let yy = y; yy < y + h; yy++) {
          for (let xx = x; xx < x + w; xx++) {
            const at = (yy * width + xx) * 4
            pixels.set([r!, g!, b!, 255], at)
          }
        }
      },
      getImageData(_x: number, _y: number, w: number, h: number) {
        const data = Uint8ClampedArray.from(pixels.slice(0, w * h * 4), (value, index) =>
          noise ? noise(value, index) : value,
        )
        return { data }
      },
    }
    return {
      get width() { return width },
      set width(value: number) { width = value; pixels = new Uint8ClampedArray(width * height * 4) },
      get height() { return height },
      set height(value: number) { height = value; pixels = new Uint8ClampedArray(width * height * 4) },
      getContext: () => context,
    }
  }
}

function withCanvas(factory: () => unknown) {
  const original = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? factory() : original(tag)) as typeof document.createElement)
}

afterEach(() => vi.restoreAllMocks())

describe('canvas noise canary', () => {
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
})
