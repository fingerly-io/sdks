/**
 * Canvas and WebGL collectors.
 *
 * - Both `shieldsSource` and `canvasSource` consult `isRfpCanvasBlocked(ctx)`
 *   from Stage 1 before creating a `<canvas>` or calling `getImageData`.
 * - When unlocked, `canvasSource` hashes raw `Uint8ClampedArray` RGBA pixel
 *   bytes via `hash64` (`< 1.5ms`), avoiding slow PNG encoding (`toDataURL`).
 */

import {
  BlockedSignal,
  hash64,
  SOURCE,
  UnsupportedSignal,
  type CanvasSignal,
  type Source,
  type SourceContext,
  type WebGLSignal,
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

/** Shapes, blend modes and arcs — hashed directly over raw RGBA pixel bytes. */
function renderGeometryHash(ctx: SourceContext): string {
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

  return hash64(context.getImageData(0, 0, width, height).data)
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
  timeoutMs: 250,
  run(ctx) {
    requireWindow()
    if (typeof document === 'undefined') throw new UnsupportedSignal('no-document')

    if (isRfpCanvasBlocked(ctx)) {
      throw new BlockedSignal('rfp-canvas-prompt-avoided')
    }

    try {
      const geometryFirst = renderGeometryHash(ctx)
      const geometrySecond = renderGeometryHash(ctx)
      const textFirst = renderTextHash(ctx)
      const textSecond = renderTextHash(ctx)

      const unstable = geometryFirst !== geometrySecond || textFirst !== textSecond

      return compact<CanvasSignal>({
        geometry: geometryFirst,
        text: textFirst,
        winding: attempt(() => supportsWinding(ctx)),
        unstable,
      })
    } catch (error) {
      asBlockedIfRefused(error)
    }
  },
}

function webglContext(): WebGLRenderingContext {
  if (typeof document === 'undefined') throw new UnsupportedSignal('no-document')
  const canvas = document.createElement('canvas')
  const gl =
    canvas.getContext('webgl') ??
    (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
  if (!gl) throw new UnsupportedSignal('no-webgl-context')
  return gl
}

export const webglSource: Source<WebGLSignal> = {
  id: SOURCE.webgl,
  stage: 'collect',
  timeoutMs: 250,
  run() {
    const gl = webglContext()

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
