/**
 * Canvas and WebGL collectors.
 *
 * - `shieldsSource`, `canvasSource`, and `webglSource`'s pixel readback all
 *   consult `isRfpCanvasBlocked(ctx)` from Stage 1 before reading pixels so
 *   Firefox `resistFingerprinting` / Tor Browser never displays a doorhanger.
 * - When unlocked, `canvasSource` hashes raw `Uint8ClampedArray` RGBA pixel
 *   bytes via `hash64` (`< 1.5ms`), avoiding slow PNG encoding (`toDataURL`),
 *   and also hashes `byte & 0xfe` over geometry and generic-font text to
 *   recover the exact image from Brave's 1-bit LSB pixel perturbation.
 */

import {
  BlockedSignal,
  hash64,
  SOURCE,
  UnsupportedSignal,
  type CanvasSignal,
  type Source,
  type SourceContext,
  type WebGL2Signal,
  type WebGLSignal,
  type WebGPUSignal,
} from '@fingerly/core'

import { asBlockedIfRefused, attempt, compact, requireWindow } from '../util.js'
import { isRfpCanvasBlocked } from './runtime.js'

const SHARED_CANVAS_KEY = 'canvas2d'

interface SharedCanvas2D {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
}

/**
 * Reuses one detached `<canvas>` 2D context per `collect()` pass when `ctx.shared`
 * is present, resetting dimensions (`width`/`height`) before each draw.
 */
export function acquireCanvas2D(
  ctx: SourceContext | undefined,
  width: number,
  height: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] | undefined {
  if (typeof document === 'undefined') return undefined

  const shared = ctx?.shared
  const existing = shared?.get(SHARED_CANVAS_KEY) as SharedCanvas2D | undefined
  if (existing) {
    existing.canvas.width = width
    existing.canvas.height = height
    return [existing.canvas, existing.context]
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context =
    canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d')
  if (!context) return undefined

  shared?.set(SHARED_CANVAS_KEY, { canvas, context })
  return [canvas, context]
}

function requireCanvas2D(
  ctx: SourceContext | undefined,
  width: number,
  height: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const pair = acquireCanvas2D(ctx, width, height)
  if (!pair) throw new UnsupportedSignal('no-2d-context')
  return pair
}

/**
 * Hashes `data` with bit 0 cleared on every byte (`byte & 0xfe`).
 *
 * Brave's `BraveSessionCache::PerturbPixelsInternal` XORs at most 512 RGB
 * channel bytes with `bit & 0x1`, leaving bits 7..1 untouched.
 */
function hashHighBits(data: Uint8ClampedArray | Uint8Array): string {
  const masked = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    masked[i] = (data[i] ?? 0) & 0xfe
  }
  return hash64(masked)
}

interface GeometryRender {
  full: string
  high: string
}

/** Shapes, blend modes and arcs — hashed directly over raw RGBA pixel bytes. */
function renderGeometry(ctx: SourceContext): GeometryRender {
  const width = 240
  const height = 60
  const [, context] = requireCanvas2D(ctx, width, height)

  context.globalCompositeOperation = 'multiply'
  for (const [colour, x, y] of [
    ['#f2f', 40, 40],
    ['#2ff', 80, 40],
    ['#ff2', 60, 80],
  ] as const) {
    context.fillStyle = colour
    context.beginPath()
    context.arc(x, y, 40, 0, Math.PI * 2, true)
    context.closePath()
    context.fill()
  }

  context.fillStyle = '#f9c'
  context.arc(100, 50, 50, 0, Math.PI * 2, true)
  context.arc(100, 50, 20, 0, Math.PI * 2, true)
  context.fill('evenodd')

  const pixels = context.getImageData(0, 0, width, height).data
  return { full: hash64(pixels), high: hashHighBits(pixels) }
}

/** Multi-script text rasterisation — hashed directly over raw RGBA pixel bytes. */
function renderTextHash(ctx: SourceContext): string {
  const width = 300
  const height = 60
  const [, context] = requireCanvas2D(ctx, width, height)

  context.textBaseline = 'alphabetic'
  context.fillStyle = '#f60'
  context.fillRect(100, 1, 62, 20)

  context.fillStyle = '#069'
  context.font = '11pt "Times New Roman"'
  context.fillText('Fingerly <canvas> 1.0 \u{1F512}Ж中', 2, 15)

  context.font = '18pt Arial'
  context.fillStyle = 'rgba(102, 204, 0, 0.7)'
  context.fillText('Fingerly <canvas> 1.0', 4, 45)

  return hash64(context.getImageData(0, 0, width, height).data)
}

interface GenericTextRender {
  high: string
  metricsWidth: number | undefined
}

/**
 * Text rasterisation using only CSS generic font families (`serif`,
 * `sans-serif`, `monospace`) and ASCII glyphs.
 *
 * Brave's `BRAVE_GET_FONT_DATA` exempts `curr_family->FamilyIsGeneric()`
 * unconditionally while randomly hiding non-allowlisted named fonts per
 * session, so generic families with ASCII text render identically across
 * sessions once bit 0 is masked (`byte & 0xfe`). Also probes `measureText`
 * width, which Brave's strict mode stubs to an empty `TextMetrics` (`0`).
 */
function renderGenericTextHigh(ctx: SourceContext): GenericTextRender {
  const width = 300
  const height = 60
  const [, context] = requireCanvas2D(ctx, width, height)

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)

  context.textBaseline = 'alphabetic'
  context.fillStyle = '#f60'
  context.fillRect(100, 1, 62, 20)

  context.fillStyle = '#069'
  context.font = '11pt serif'
  context.fillText('Fingerly <canvas> 1.0 Cwm fjordbank glyphs vext quiz, 0123456789', 2, 15)

  context.font = '18pt sans-serif'
  context.fillStyle = 'rgba(102, 204, 0, 0.7)'
  context.fillText('Fingerly <canvas> 1.0 !@#$%&*()', 4, 45)

  const metricsWidth = attempt(() => {
    if (typeof context.measureText !== 'function') return undefined
    const measured = context.measureText('Fingerly <canvas> 1.0')?.width
    return typeof measured === 'number' && Number.isFinite(measured)
      ? Math.round(measured * 1000) / 1000
      : undefined
  })

  context.font = '13pt monospace'
  context.fillStyle = '#314'
  context.fillText('0O1lI {}[]<> ~+=', 180, 52)

  const pixels = context.getImageData(0, 0, width, height).data
  return { high: hashHighBits(pixels), metricsWidth }
}

/** Whether the renderer supports an even-odd winding rule. */
function supportsWinding(ctx: SourceContext): boolean {
  const [, context] = requireCanvas2D(ctx, 1, 1)
  context.rect(0, 0, 10, 10)
  context.rect(2, 2, 6, 6)
  return context.isPointInPath(5, 5, 'evenodd') === false
}

export const canvasSource: Source<CanvasSignal> = {
  id: SOURCE.canvas,
  stage: 'collect',
  identityCritical: true,
  timeoutMs: 750,
  run(ctx) {
    requireWindow()
    if (typeof document === 'undefined') throw new UnsupportedSignal('no-document')

    if (isRfpCanvasBlocked(ctx)) {
      throw new BlockedSignal('rfp-canvas-prompt-avoided')
    }

    try {
      const geometryFirst = renderGeometry(ctx)
      const geometrySecond = renderGeometry(ctx)
      const textFirst = renderTextHash(ctx)
      const textSecond = renderTextHash(ctx)
      const genericFirst = renderGenericTextHigh(ctx)
      const genericSecond = renderGenericTextHigh(ctx)

      const unstable = geometryFirst.full !== geometrySecond.full || textFirst !== textSecond
      const highStable =
        geometryFirst.high === geometrySecond.high && genericFirst.high === genericSecond.high

      return compact<CanvasSignal>({
        geometry: geometryFirst.full,
        text: textFirst,
        geometry_high: highStable ? geometryFirst.high : undefined,
        text_high: highStable ? genericFirst.high : undefined,
        text_metrics_width: genericFirst.metricsWidth,
        winding: attempt(() => supportsWinding(ctx)),
        unstable,
      })
    } catch (error) {
      asBlockedIfRefused(error)
    }
  },
}

const WEBGL_SCENE_SIZE = 64

const WEBGL_VERTEX_SHADER = `
attribute vec2 aPos;
attribute vec3 aCol;
varying vec3 vCol;
varying vec2 vPos;
void main() {
  vCol = aCol;
  vPos = aPos;
  gl_Position = vec4(aPos.x * 0.93 - 0.04, aPos.y * 0.91 + 0.03, 0.0, 1.0);
}
`

const WEBGL_FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vCol;
varying vec2 vPos;
void main() {
  float wave = sin(vPos.x * 13.7 + vPos.y * 9.3) * 0.5 + 0.5;
  float rad = sqrt(dot(vPos, vPos) + 0.01);
  vec3 c = mix(vCol, vec3(wave, 1.0 - wave, fract(rad * 7.13)), 0.37);
  gl_FragColor = vec4(c, 1.0);
}
`

const WEBGL_VERTICES = new Float32Array([
  -0.85, -0.75, 0.9, 0.2, 0.4,
  0.9, -0.65, 0.1, 0.8, 0.6,
  -0.15, 0.88, 0.3, 0.4, 0.95,
  -0.6, 0.7, 0.8, 0.7, 0.1,
  0.75, 0.8, 0.2, 0.9, 0.8,
  0.2, -0.85, 0.95, 0.3, 0.7,
])

interface WebGLSceneReading {
  renderHash?: string | undefined
  shaderBlocked?: boolean | undefined
}

/**
 * Draws two overlapping wave-shaded triangles into `gl` and hashes raw
 * `readPixels` RGBA bytes. Brave leaves WebGL rasterisation and `readPixels`
 * completely untouched in standard mode, while stubbing `createShader` to
 * `null` in strict mode.
 */
function renderWebGLScene(gl: WebGLRenderingContext): WebGLSceneReading {
  if (typeof gl.createShader !== 'function' || typeof gl.readPixels !== 'function') {
    return {}
  }

  let vs: WebGLShader | null = null
  let fs: WebGLShader | null = null
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null

  try {
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        attempt(() => gl.deleteShader(shader))
        return null
      }
      return shader
    }

    vs = compile(gl.VERTEX_SHADER, WEBGL_VERTEX_SHADER)
    if (!vs) return { shaderBlocked: true }
    fs = compile(gl.FRAGMENT_SHADER, WEBGL_FRAGMENT_SHADER)
    if (!fs) return { shaderBlocked: true }

    program = gl.createProgram()
    if (!program) return { shaderBlocked: true }
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return {}
    }

    gl.useProgram(program)
    buffer = gl.createBuffer()
    if (!buffer) return {}
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, WEBGL_VERTICES, gl.STATIC_DRAW)

    const aPos = gl.getAttribLocation(program, 'aPos')
    const aCol = gl.getAttribLocation(program, 'aCol')
    if (aPos < 0 || aCol < 0) return {}
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 20, 0)
    gl.enableVertexAttribArray(aCol)
    gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 20, 8)

    gl.viewport(0, 0, WEBGL_SCENE_SIZE, WEBGL_SCENE_SIZE)
    gl.clearColor(0.11, 0.17, 0.23, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    const pixels = new Uint8Array(WEBGL_SCENE_SIZE * WEBGL_SCENE_SIZE * 4)
    gl.readPixels(0, 0, WEBGL_SCENE_SIZE, WEBGL_SCENE_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    if (typeof gl.getError === 'function' && gl.getError() !== gl.NO_ERROR) {
      return {}
    }

    const r0 = pixels[0] ?? 0
    const g0 = pixels[1] ?? 0
    const b0 = pixels[2] ?? 0
    let varied = false
    for (let i = 4; i < pixels.length; i += 4) {
      if (pixels[i] !== r0 || pixels[i + 1] !== g0 || pixels[i + 2] !== b0) {
        varied = true
        break
      }
    }
    if (!varied) return {}

    return { renderHash: hash64(pixels) }
  } catch {
    return {}
  } finally {
    if (buffer) attempt(() => gl.deleteBuffer(buffer))
    if (program) attempt(() => gl.deleteProgram(program))
    if (vs) attempt(() => gl.deleteShader(vs))
    if (fs) attempt(() => gl.deleteShader(fs))
  }
}

function webglContext(width?: number, height?: number): WebGLRenderingContext {
  if (typeof document === 'undefined') throw new UnsupportedSignal('no-document')
  const canvas = document.createElement('canvas')
  if (width !== undefined) canvas.width = width
  if (height !== undefined) canvas.height = height
  const gl =
    canvas.getContext('webgl') ??
    (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
  if (!gl) throw new UnsupportedSignal('no-webgl-context')
  return gl
}

export const webglSource: Source<WebGLSignal> = {
  id: SOURCE.webgl,
  stage: 'collect',
  identityCritical: true,
  timeoutMs: 750,
  run(ctx) {
    const gl = webglContext(WEBGL_SCENE_SIZE, WEBGL_SCENE_SIZE)

    try {
      const debug = attempt(() => gl.getExtension('WEBGL_debug_renderer_info'))

      const parameters: Record<string, unknown> = {}
      for (const name of [
        'MAX_TEXTURE_SIZE',
        'MAX_VIEWPORT_DIMS',
        'MAX_VERTEX_ATTRIBS',
        'MAX_VARYING_VECTORS',
        'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
        'MAX_CUBE_MAP_TEXTURE_SIZE',
        'MAX_FRAGMENT_UNIFORM_VECTORS',
        'MAX_RENDERBUFFER_SIZE',
        'MAX_TEXTURE_IMAGE_UNITS',
        'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
        'MAX_VERTEX_UNIFORM_VECTORS',
        'ALIASED_LINE_WIDTH_RANGE',
        'ALIASED_POINT_SIZE_RANGE',
        'RED_BITS',
        'GREEN_BITS',
        'BLUE_BITS',
        'ALPHA_BITS',
        'DEPTH_BITS',
        'STENCIL_BITS',
      ]) {
        const constant = (gl as unknown as Record<string, number>)[name]
        if (typeof constant !== 'number') continue
        const value = attempt(() => gl.getParameter(constant))
        if (value !== undefined && value !== null) {
          parameters[name] = ArrayBuffer.isView(value)
            ? Array.from(value as unknown as number[])
            : value
        }
      }

      const precisions: number[] = []
      for (const shader of [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER]) {
        for (const precision of [gl.LOW_FLOAT, gl.MEDIUM_FLOAT, gl.HIGH_FLOAT]) {
          const format = attempt(() => gl.getShaderPrecisionFormat(shader, precision))
          if (format) precisions.push(format.rangeMin, format.rangeMax, format.precision)
        }
      }

      const scene: WebGLSceneReading = isRfpCanvasBlocked(ctx) ? {} : renderWebGLScene(gl)

      return compact<WebGLSignal>({
        vendor: attempt(() => gl.getParameter(gl.VENDOR) as string),
        renderer: attempt(() => gl.getParameter(gl.RENDERER) as string),
        unmasked_vendor: debug
          ? attempt(() => gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) as string)
          : undefined,
        unmasked_renderer: debug
          ? attempt(() => gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string)
          : undefined,
        version: attempt(() => gl.getParameter(gl.VERSION) as string),
        shading_language_version: attempt(
          () => gl.getParameter(gl.SHADING_LANGUAGE_VERSION) as string,
        ),
        max_texture_size: attempt(() => gl.getParameter(gl.MAX_TEXTURE_SIZE) as number),
        max_render_buffer_size: attempt(() => gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number),
        parameters_hash:
          Object.keys(parameters).length > 0 ? hash64(JSON.stringify(parameters)) : undefined,
        shader_precision_hash: precisions.length > 0 ? hash64(precisions.join(',')) : undefined,
        render_hash: scene.renderHash,
        shader_blocked: scene.shaderBlocked,
      })
    } finally {
      attempt(() => gl.getExtension('WEBGL_lose_context')?.loseContext())
    }
  },
}

export const webglExtensionsSource: Source<string[]> = {
  id: SOURCE.webglExtensions,
  stage: 'collect',
  timeoutMs: 200,
  run() {
    const gl = webglContext()
    try {
      const extensions = gl.getSupportedExtensions()
      if (!extensions) throw new BlockedSignal('extensions-withheld')
      return [...extensions].sort()
    } finally {
      attempt(() => gl.getExtension('WEBGL_lose_context')?.loseContext())
    }
  },
}

const WEBGL2_LIMIT_NAMES = [
  'MAX_3D_TEXTURE_SIZE',
  'MAX_ARRAY_TEXTURE_LAYERS',
  'MAX_COLOR_ATTACHMENTS',
  'MAX_COMBINED_UNIFORM_BLOCKS',
  'MAX_DRAW_BUFFERS',
  'MAX_ELEMENTS_INDICES',
  'MAX_ELEMENTS_VERTICES',
  'MAX_FRAGMENT_INPUT_COMPONENTS',
  'MAX_FRAGMENT_UNIFORM_BLOCKS',
  'MAX_FRAGMENT_UNIFORM_COMPONENTS',
  'MAX_PROGRAM_TEXEL_OFFSET',
  'MAX_SAMPLES',
  'MAX_TEXTURE_LOD_BIAS',
  'MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS',
  'MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS',
  'MAX_UNIFORM_BLOCK_SIZE',
  'MAX_UNIFORM_BUFFER_BINDINGS',
  'MAX_VARYING_COMPONENTS',
  'MAX_VERTEX_OUTPUT_COMPONENTS',
  'MAX_VERTEX_UNIFORM_BLOCKS',
  'MAX_VERTEX_UNIFORM_COMPONENTS',
] as const

export const webgl2Source: Source<WebGL2Signal> = {
  id: SOURCE.webgl2,
  stage: 'collect',
  identityCritical: true,
  timeoutMs: 750,
  run() {
    if (typeof document === 'undefined') throw new UnsupportedSignal('no-document')
    const canvas = document.createElement('canvas')
    const gl2 = canvas.getContext('webgl2')
    if (!gl2) throw new UnsupportedSignal('no-webgl2-context')

    try {
      const limits: Record<string, number | number[]> = {}
      for (const name of WEBGL2_LIMIT_NAMES) {
        const constant = (gl2 as unknown as Record<string, number>)[name]
        if (typeof constant !== 'number') continue
        const value = attempt(() => gl2.getParameter(constant))
        if (typeof value === 'number' && Number.isFinite(value)) {
          limits[name] = value
        } else if (ArrayBuffer.isView(value)) {
          limits[name] = Array.from(value as unknown as number[])
        }
      }
      const rawExt = attempt(() => gl2.getSupportedExtensions())
      const extensions = Array.isArray(rawExt) ? [...rawExt].sort() : undefined

      return compact<WebGL2Signal>({
        limits: Object.keys(limits).length > 0 ? limits : undefined,
        extensions: extensions && extensions.length > 0 ? extensions : undefined,
      })
    } finally {
      attempt(() => gl2.getExtension('WEBGL_lose_context')?.loseContext())
    }
  },
}

interface GPUAdapterLike {
  features?: Iterable<string>
  limits?: Record<string, unknown>
  info?: { vendor?: string; architecture?: string }
}

const WEBGPU_LIMIT_KEYS = [
  'maxTextureDimension2D',
  'maxTextureDimension3D',
  'maxTextureArrayLayers',
  'maxBindGroups',
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxUniformBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxColorAttachments',
  'maxColorAttachmentBytesPerSample',
] as const

export const webgpuSource: Source<WebGPUSignal> = {
  id: SOURCE.webgpu,
  stage: 'collect',
  timeoutMs: 120,
  async run() {
    if (typeof navigator === 'undefined') throw new UnsupportedSignal('no-navigator')
    const gpu = (
      navigator as Navigator & {
        gpu?: { requestAdapter?: () => Promise<GPUAdapterLike | null> }
      }
    ).gpu
    if (typeof gpu?.requestAdapter !== 'function') {
      throw new UnsupportedSignal('no-webgpu')
    }

    const adapter = await gpu.requestAdapter()
    if (!adapter) throw new UnsupportedSignal('no-webgpu-adapter')

    const features = attempt(() => (adapter.features ? [...adapter.features].sort() : undefined))
    const limits: Record<string, number> = {}
    if (adapter.limits) {
      for (const key of WEBGPU_LIMIT_KEYS) {
        const val = attempt(() => (adapter.limits as Record<string, unknown>)[key])
        if (typeof val === 'number' && Number.isFinite(val)) {
          limits[key] = val
        }
      }
    }

    return compact<WebGPUSignal>({
      features: features && features.length > 0 ? features : undefined,
      limits: Object.keys(limits).length > 0 ? limits : undefined,
      vendor: attempt(() => adapter.info?.vendor) || undefined,
      architecture: attempt(() => adapter.info?.architecture) || undefined,
    })
  },
}
