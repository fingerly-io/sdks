// @vitest-environment happy-dom

import { collect, SOURCE, type Source, type SourceContext } from '@fingerly/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { audioSource } from '../src/sources/audio.js'
import { browserSources } from '../src/sources/index.js'
import { canvasSource, webglSource } from '../src/sources/render.js'

function unlockedCtx(): SourceContext {
  return {
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
    shared: new Map(),
  }
}

function rfpBlockedCtx(): SourceContext {
  return {
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
}

function makeFakeCanvas2D(options: {
  seed?: number
  metricsWidth?: number
  namedFontJitter?: number
}) {
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
        for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) {
          for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) {
            const at = (yy * width + xx) * 4
            pixels.set([r, g, b, 255], at)
          }
        }
      },
      fillText(text: string, x: number, y: number) {
        const isGeneric = /\b(serif|sans-serif|monospace)\b/.test(context.font) && !context.font.includes('"')
        const fontShift = !isGeneric && options.namedFontJitter ? options.namedFontJitter : 0
        for (let i = 0; i < text.length; i++) {
          const xx = (x + i * 3 + fontShift) % Math.max(1, width)
          const yy = y % Math.max(1, height)
          const at = (yy * width + xx) * 4
          const code = text.charCodeAt(i) & 0xff
          if (at + 3 < pixels.length) {
            pixels.set([(code * 7) & 0xff, (code * 13) & 0xff, (code * 29) & 0xff, 255], at)
          }
        }
      },
      measureText: () => ({ width: options.metricsWidth ?? 184.25 }),
      beginPath() {},
      arc(x: number, y: number, r: number) {
        const at = ((y % Math.max(1, height)) * width + ((x + r) % Math.max(1, width))) * 4
        if (at + 3 < pixels.length) {
          pixels.set([120, 180, 210, 255], at)
        }
      },
      closePath() {},
      fill() {},
      rect() {},
      isPointInPath: () => false,
      getImageData(_x: number, _y: number, w: number, h: number) {
        const data = Uint8ClampedArray.from(pixels.slice(0, w * h * 4))
        // Simulate Brave's PerturbPixelsInternal: flip bit 0 (`^= 1`) on up to
        // 512 RGB channel bytes derived deterministically from a session seed.
        if (options.seed !== undefined && data.length >= 4) {
          const pixelCount = Math.floor(data.length / 4)
          let s = options.seed >>> 0
          for (let k = 0; k < 512; k++) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0
            const channel = s % 3
            const idx = 4 * (s % pixelCount) + channel
            data[idx] = (data[idx] ?? 0) ^ (s & 1)
          }
        }
        return { data }
      },
    }
    return {
      get width() {
        return width
      },
      set width(v: number) {
        width = v
        pixels = new Uint8ClampedArray(width * height * 4)
      },
      get height() {
        return height
      },
      set height(v: number) {
        height = v
        pixels = new Uint8ClampedArray(width * height * 4)
      },
      getContext: (kind: string) => (kind === '2d' ? context : null),
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Brave-resilient canvas, WebGL, and audio collectors', () => {
  it('recovers exact geometry_high and text_high across Brave 1-bit LSB farbling and hidden named fonts', async () => {
    const origCreate = document.createElement.bind(document)

    // Baseline unfarbled render (e.g. Chrome on the same machine).
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? makeFakeCanvas2D({})() : origCreate(tag)) as typeof document.createElement)
    const clean = await canvasSource.run(unlockedCtx())

    // Session 1 in Brave: 1-bit LSB perturbation + named-font farbling.
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas'
        ? makeFakeCanvas2D({ seed: 0x12345678, namedFontJitter: 2 })()
        : origCreate(tag)) as typeof document.createElement)
    const sessionOne = await canvasSource.run(unlockedCtx())

    // Session 2 after Brave restart: fresh seed + different named-font farbling.
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas'
        ? makeFakeCanvas2D({ seed: 0xdeadbeef, namedFontJitter: 5 })()
        : origCreate(tag)) as typeof document.createElement)
    const sessionTwo = await canvasSource.run(unlockedCtx())

    // Raw hashes diverge per session, while high-bit hashes match each other and Chrome.
    expect(sessionOne.geometry).not.toBe(sessionTwo.geometry)
    expect(sessionOne.text).not.toBe(sessionTwo.text)
    expect(sessionOne.geometry_high).toBe(clean.geometry_high)
    expect(sessionTwo.geometry_high).toBe(clean.geometry_high)
    expect(sessionOne.text_high).toBe(clean.text_high)
    expect(sessionTwo.text_high).toBe(clean.text_high)
    expect(sessionOne.text_metrics_width).toBe(184.25)
  })

  it('records text_metrics_width = 0 when strict mode stubs TextMetrics', async () => {
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas'
        ? makeFakeCanvas2D({ seed: 0x99, metricsWidth: 0 })()
        : origCreate(tag)) as typeof document.createElement)

    const strict = await canvasSource.run(unlockedCtx())
    expect(strict.text_metrics_width).toBe(0)
  })

  it('hashes WebGL scene pixels when unlocked, marks shader_blocked in strict mode, and skips readPixels under RFP', async () => {
    const origCreate = document.createElement.bind(document)
    const readPixelsSpy = vi.fn((_x: number, _y: number, w: number, h: number, _f: number, _t: number, dst: Uint8Array) => {
      for (let i = 0; i < w * h * 4; i++) {
        dst[i] = (i * 37 + 19) & 0xff
      }
    })

    const makeWebGLCanvas = (shaderNull: boolean) => ({
      width: 0,
      height: 0,
      getContext: (kind: string) => {
        if (kind !== 'webgl' && kind !== 'experimental-webgl') return null
        return {
          NO_ERROR: 0,
          VENDOR: 0x1f00,
          RENDERER: 0x1f01,
          VERSION: 0x1f02,
          SHADING_LANGUAGE_VERSION: 0x8b8c,
          MAX_TEXTURE_SIZE: 0x0d33,
          MAX_RENDERBUFFER_SIZE: 0x84e8,
          VERTEX_SHADER: 0x8b31,
          FRAGMENT_SHADER: 0x8b30,
          COMPILE_STATUS: 0x8b81,
          LINK_STATUS: 0x8b82,
          ARRAY_BUFFER: 0x8892,
          STATIC_DRAW: 0x88e4,
          FLOAT: 0x1406,
          COLOR_BUFFER_BIT: 0x4000,
          BLEND: 0x0be2,
          SRC_ALPHA: 0x0302,
          ONE_MINUS_SRC_ALPHA: 0x0303,
          TRIANGLES: 0x0004,
          RGBA: 0x1908,
          UNSIGNED_BYTE: 0x1401,
          LOW_FLOAT: 0x8df0,
          MEDIUM_FLOAT: 0x8df1,
          HIGH_FLOAT: 0x8df2,
          getExtension: (ext: string) =>
            ext === 'WEBGL_debug_renderer_info'
              ? { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 }
              : ext === 'WEBGL_lose_context'
                ? { loseContext: () => undefined }
                : null,
          getParameter: (p: number) => (p === 0x9245 || p === 0x9246 ? 'Brave' : 16384),
          getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
          createShader: () => (shaderNull ? null : ({} as WebGLShader)),
          shaderSource: () => undefined,
          compileShader: () => undefined,
          getShaderParameter: () => true,
          deleteShader: () => undefined,
          createProgram: () => ({} as WebGLProgram),
          attachShader: () => undefined,
          linkProgram: () => undefined,
          getProgramParameter: () => true,
          useProgram: () => undefined,
          deleteProgram: () => undefined,
          createBuffer: () => ({} as WebGLBuffer),
          bindBuffer: () => undefined,
          bufferData: () => undefined,
          deleteBuffer: () => undefined,
          getAttribLocation: (_prog: unknown, name: string) => (name === 'aPos' ? 0 : 1),
          enableVertexAttribArray: () => undefined,
          vertexAttribPointer: () => undefined,
          viewport: () => undefined,
          clearColor: () => undefined,
          clear: () => undefined,
          enable: () => undefined,
          blendFunc: () => undefined,
          drawArrays: () => undefined,
          readPixels: readPixelsSpy,
          getError: () => 0,
        }
      },
    })

    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? makeWebGLCanvas(false) : origCreate(tag)) as typeof document.createElement)
    const normal = await webglSource.run(unlockedCtx())
    expect(normal.render_hash).toMatch(/^[0-9a-f]{16}$/)
    expect(normal.shader_blocked).toBeUndefined()
    expect(readPixelsSpy).toHaveBeenCalledTimes(1)

    // Strict Gecko RFP: readPixels must never be called.
    readPixelsSpy.mockClear()
    const rfp = await webglSource.run(rfpBlockedCtx())
    expect(rfp.render_hash).toBeUndefined()
    expect(readPixelsSpy).not.toHaveBeenCalled()

    // Brave strict mode: createShader returns null -> shader_blocked: true.
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? makeWebGLCanvas(true) : origCreate(tag)) as typeof document.createElement)
    const strict = await webglSource.run(unlockedCtx())
    expect(strict.render_hash).toBeUndefined()
    expect(strict.shader_blocked).toBe(true)
  })

  it('cancels constant-multiplier audio farbling via ratios and exposes non-negative strict LFSR replacement', async () => {
    const baseWaveform = new Float32Array(5000)
    for (let i = 0; i < 5000; i++) {
      baseWaveform[i] = Math.sin(i * 0.71) * Math.exp(-(i - 4500) * 0.0004) * 0.3
    }

    const mockOfflineAudio = (scale: number, strictPositiveNoise = false) => {
      class FakeOfflineAudioContext {
        createOscillator() {
          return { type: 'sine', frequency: { value: 0 }, connect() {}, start() {} }
        }
        createDynamicsCompressor() {
          return {
            threshold: { value: 0 },
            knee: { value: 0 },
            ratio: { value: 0 },
            attack: { value: 0 },
            release: { value: 0 },
            connect() {},
          }
        }
        get destination() {
          return {}
        }
        async startRendering() {
          const out = new Float32Array(5000)
          for (let i = 0; i < 5000; i++) {
            out[i] = strictPositiveNoise ? ((i * 7919) % 1000 + 1) / 10000 : (baseWaveform[i] ?? 0) * scale
          }
          return { getChannelData: () => out } as unknown as AudioBuffer
        }
      }
      vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext)
    }

    mockOfflineAudio(1.0)
    const unfarbled = await audioSource.run(unlockedCtx())

    mockOfflineAudio(0.9991732)
    const farbledA = await audioSource.run(unlockedCtx())

    mockOfflineAudio(0.9998841)
    const farbledB = await audioSource.run(unlockedCtx())

    expect(farbledA.value).not.toBe(farbledB.value)
    expect(farbledA.crest_ratio).toBeCloseTo(unfarbled.crest_ratio!, 4)
    expect(farbledB.crest_ratio).toBeCloseTo(unfarbled.crest_ratio!, 4)
    expect(farbledA.shape_ratio).toBeCloseTo(unfarbled.shape_ratio!, 7)
    expect(farbledB.shape_ratio).toBeCloseTo(unfarbled.shape_ratio!, 7)
    expect(farbledA.decay_ratio).toBeCloseTo(unfarbled.decay_ratio!, 6)
    expect(farbledB.decay_ratio).toBeCloseTo(unfarbled.decay_ratio!, 6)
    expect(farbledA.negative_samples).toBeGreaterThan(200)

    // Strict mode LFSR noise: all samples in [0, 0.1].
    mockOfflineAudio(1.0, true)
    const strict = await audioSource.run(unlockedCtx())
    expect(strict.negative_samples).toBe(0)
  })

  it('never starves foundational synchronous sources when cold GPU/audio critical sources exceed 350ms', async () => {
    const blockSync = (ms: number) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        // simulate synchronous cold GPU process startup on main thread
      }
    }
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const simulated: Source[] = browserSources.map((src) => {
      if (src.id === SOURCE.webgl) {
        return {
          ...src,
          timeoutMs: 600,
          run: () => {
            blockSync(380)
            return { render_hash: '2b3b02f34bc0d067' }
          },
        }
      }
      if (src.id === SOURCE.audio || src.id === SOURCE.codecs || src.id === SOURCE.shields) {
        return {
          ...src,
          timeoutMs: 600,
          run: async () => {
            await sleep(40)
            return { ok: true }
          },
        }
      }
      return src
    })

    const { outcomes } = await collect(simulated)

    for (const id of [
      SOURCE.engine,
      SOURCE.timing,
      SOURCE.errors,
      SOURCE.math,
      SOURCE.navigator,
      SOURCE.languages,
      SOURCE.vendor,
      SOURCE.screen,
      SOURCE.hardware,
      SOURCE.touch,
      SOURCE.intl,
      SOURCE.timezone,
      SOURCE.webgl,
      SOURCE.shields,
      SOURCE.codecs,
      SOURCE.audio,
    ]) {
      expect(outcomes[id]?.status, `${id} should not starve on cold start`).toBe('ok')
    }
  })
})
