/**
 * Canvas and WebGL.
 *
 * The classic high-entropy sources, with one addition that matters more than
 * the entropy does: every render is performed **twice** and the two results
 * compared. A canvas that returns different pixels for the same drawing is a
 * canvas being deliberately noised - Brave's farbling, Tor's resistFingerprinting,
 * every anti-detect browser - and knowing that is worth strictly more than the
 * hash it invalidates.
 *
 * Rendering once and hashing would give a noised canvas a different visitor on
 * every visit, with no way to tell that apart from a genuinely new device.
 */

import {
  BlockedSignal,
  hash64,
  SOURCE,
  UnsupportedSignal,
  type CanvasSignal,
  type Source,
  type SourceContext,
  type TimingSignal,
  type WebGLSignal,
} from '@fingerly/core'

import { asBlockedIfRefused, attempt, compact, requireWindow } from '../util.js'

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new UnsupportedSignal('no-2d-context')
  return [canvas, context]
}

/** Shapes, blend modes and arcs - where rasterisation differences show up. */
function renderGeometry(): string {
  const [canvas, ctx] = makeCanvas(240, 60)

  ctx.globalCompositeOperation = 'multiply'
  for (const [colour, x, y] of [
    ['#f2f', 40, 40],
    ['#2ff', 80, 40],
    ['#ff2', 60, 80],
  ] as const) {
    ctx.fillStyle = colour
    ctx.beginPath()
    ctx.arc(x, y, 40, 0, Math.PI * 2, true)
    ctx.closePath()
    ctx.fill()
  }

  // An even-odd fill with a hole in it. The winding rule is implemented
  // differently across rasterisers and this is where that shows.
  ctx.fillStyle = '#f9c'
  ctx.arc(100, 50, 50, 0, Math.PI * 2, true)
  ctx.arc(100, 50, 20, 0, Math.PI * 2, true)
  ctx.fill('evenodd')

  return canvas.toDataURL()
}

/** Text, where font availability, hinting and subpixel rendering show up. */
function renderText(): string {
  const [canvas, ctx] = makeCanvas(300, 60)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#f60'
  ctx.fillRect(100, 1, 62, 20)

  ctx.fillStyle = '#069'
  // A string spanning several scripts and an emoji: each is drawn from a
  // different font on most systems, so the composite width reveals more of the
  // font stack than a Latin string alone would.
  ctx.font = '11pt "Times New Roman"'
  ctx.fillText('Fingerly <canvas> 1.0 \u{1F512}Ж中', 2, 15)

  ctx.font = '18pt Arial'
  ctx.fillStyle = 'rgba(102, 204, 0, 0.7)'
  ctx.fillText('Fingerly <canvas> 1.0', 4, 45)

  return canvas.toDataURL()
}

/** Whether the renderer supports a non-zero winding rule at all. */
function supportsWinding(): boolean {
  const [, ctx] = makeCanvas(1, 1)
  ctx.rect(0, 0, 10, 10)
  ctx.rect(2, 2, 6, 6)
  return ctx.isPointInPath(5, 5, 'evenodd') === false
}

/**
 * Whether resistFingerprinting may be active, from the fast tier's clock probe.
 *
 * Tor 15 was measured using both a 16.667ms clamp at Standard security and a
 * 100ms clamp at Safest. The lower threshold is deliberately conservative:
 * this guard does not produce a Tor verdict, it only gives up a canvas hash to
 * uphold the stronger promise that collection never opens a permission
 * doorhanger. Tiers are barriers, so `timing` is guaranteed complete here.
 */
function resistFingerprintingActive(ctx: SourceContext): boolean {
  const timing = ctx.completed(SOURCE.timing)
  if (timing?.status !== 'ok') return false
  const resolution = (timing.value as TimingSignal | undefined)?.now_resolution
  return typeof resolution === 'number' && resolution >= 16
}

export const canvasSource: Source<CanvasSignal> = {
  id: SOURCE.canvas,
  tier: 'deferred',
  timeoutMs: 400,
  run(ctx) {
    requireWindow()
    if (typeof document === 'undefined') throw new UnsupportedSignal('no-document')

    // Do not read the canvas back under resistFingerprinting.
    //
    // Tor Browser answers `toDataURL()` with a permission doorhanger asking the
    // user whether this site may extract canvas data. This SDK must never cause
    // a browser to ask its user anything - see the rule on [[Source]] - so the
    // API is not touched at all when RFP is active.
    //
    // Nothing of value is lost. A canvas hash from an RFP browser is either
    // refused or deliberately randomised, so it could not have identified
    // anyone; and the fact being recorded here - that the browser is running a
    // canvas countermeasure - is worth more than the hash would have been. It
    // is the same `blocked` status a refusal would have produced, reached
    // without involving the visitor.
    if (resistFingerprintingActive(ctx)) {
      throw new BlockedSignal('rfp-canvas-prompt-avoided')
    }

    try {
      // Twice, and compared. A stable renderer produces identical bytes; a
      // noised one does not, and that is the finding.
      const geometryFirst = renderGeometry()
      const geometrySecond = renderGeometry()
      const textFirst = renderText()
      const textSecond = renderText()

      const unstable = geometryFirst !== geometrySecond || textFirst !== textSecond

      return compact<CanvasSignal>({
        geometry: hash64(geometryFirst),
        text: hash64(textFirst),
        winding: attempt(supportsWinding),
        unstable,
      })
    } catch (error) {
      // A refused readback is the measurement, not a failure to measure.
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
  // Renderer and GPU strings are hard identity components, and context setup
  // is synchronous; keep them in the authoritative initial report.
  tier: 'fast',
  timeoutMs: 400,
  run() {
    const gl = webglContext()

    // The unmasked strings are the useful ones - "Apple M2 Pro" rather than
    // "WebKit WebGL" - and are exactly what several browsers now withhold.
    // Absent is a signal in itself, so it is left absent rather than filled in.
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
        parameters[name] = ArrayBuffer.isView(value) ? Array.from(value as unknown as number[]) : value
      }
    }

    // Shader precision across all six stage/type pairs. Cheap, and one of the
    // few WebGL signals that survives the renderer strings being masked.
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
      // Hashed rather than sent whole: twenty parameters is a kilobyte of JSON
      // that no detector reads field by field, and the report has a budget.
      parameters_hash: Object.keys(parameters).length > 0 ? hash64(JSON.stringify(parameters)) : undefined,
      shader_precision_hash: precisions.length > 0 ? hash64(precisions.join(',')) : undefined,
    })
  },
}

export const webglExtensionsSource: Source<string[]> = {
  id: SOURCE.webglExtensions,
  tier: 'deferred',
  timeoutMs: 200,
  run() {
    const gl = webglContext()
    const extensions = gl.getSupportedExtensions()
    if (!extensions) throw new BlockedSignal('extensions-withheld')
    // Sorted: the browser's own order is not guaranteed stable across
    // releases, and an unstable order would look like a changed device.
    return [...extensions].sort()
  },
}
