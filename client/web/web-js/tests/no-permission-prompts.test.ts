// @vitest-environment happy-dom

/**
 * Rule #1 Compliance Suite:
 * The SDK must NEVER make the browser ask its user anything — neither via a
 * permission prompt nor via Firefox/Tor `resistFingerprinting` canvas readback
 * doorhangers.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BlockedSignal, SOURCE, type IdentifySubmission, type SourceContext } from '@fingerly/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { load } from '../src/index.js'
import { canvasSource } from '../src/sources/render.js'
import { shieldsSource } from '../src/sources/shields.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')

const FORBIDDEN: [pattern: RegExp, what: string][] = [
  [/\bgetUserMedia\b/, 'camera/microphone prompt'],
  [/\bgetDisplayMedia\b/, 'screen-share prompt'],
  [/\brequestPermission\s*\(/, 'Notification/DeviceMotion permission prompt invocation'],
  [/\bgetCurrentPosition\b|\bwatchPosition\b/, 'geolocation prompt'],
  [/storage\s*\.\s*persist\b/, 'persistent-storage prompt'],
  [/\brequestStorageAccess\b/, 'storage-access prompt'],
  [/\bshowOpenFilePicker\b|\bshowSaveFilePicker\b|\bshowDirectoryPicker\b/, 'file picker'],
  [/\brequestDevice\b|\brequestPort\b/, 'bluetooth/usb/hid/serial chooser'],
  [/credentials\s*\.\s*(get|create)\b/, 'credential prompt'],
  [/\brequestMIDIAccess\b/, 'MIDI prompt'],
  [/\brequestMediaKeySystemAccess\b/, 'Widevine/DRM install prompt'],
  [/\brequestFullscreen\b|\brequestPointerLock\b/, 'fullscreen/pointer-lock grab'],
  [/wakeLock\s*\.\s*request\b/, 'wake-lock request'],
  [/\bIdleDetector\b/, 'idle-detection prompt'],
  [/clipboard\s*\.\s*(read|write)/, 'clipboard prompt'],
  [/\bqueryLocalFonts\b/, 'Local Font Access prompt'],
  [/\bshare\s*\(/, 'web-share sheet'],
  [/\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/, 'blocking dialog'],
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('no source may prompt the user (static scanner)', () => {
  const files = sourceFiles(SRC)

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(FORBIDDEN)('never calls %s (%s)', (pattern, what) => {
    const offenders = files.filter((file) => pattern.test(code(readFileSync(file, 'utf8'))))
    expect(offenders, `${what} reachable from: ${offenders.join(', ')}`).toEqual([])
  })

  it('rejects a synthetic requestPermission() call while permitting structural typeof checks', () => {
    const reqPermRegex = /\brequestPermission\s*\(/
    expect(
      reqPermRegex.test(
        "typeof (DeviceMotionEvent as { requestPermission?: unknown }).requestPermission === 'function'",
      ),
    ).toBe(false)
    expect(reqPermRegex.test('DeviceMotionEvent.requestPermission()')).toBe(true)
    expect(reqPermRegex.test('Notification.requestPermission ()')).toBe(true)
  })
})

const PROMPTS_WHEN_CALLED = [
  'getUserMedia',
  'getDisplayMedia',
  'requestPermission',
  'getCurrentPosition',
  'watchPosition',
  'requestStorageAccess',
  'showOpenFilePicker',
  'showSaveFilePicker',
  'showDirectoryPicker',
  'requestDevice',
  'requestPort',
  'requestMIDIAccess',
  'requestMediaKeySystemAccess',
  'requestFullscreen',
  'requestPointerLock',
  'queryLocalFonts',
  'persist',
  'alert',
  'confirm',
]

describe('no demo page may prompt the user', () => {
  const DEMO = join(HERE, '..', 'demo')
  const pages = readdirSync(DEMO).filter((entry) => entry.endsWith('.html'))

  it('finds the demo pages', () => {
    expect(pages.length).toBeGreaterThan(0)
  })

  it.each(PROMPTS_WHEN_CALLED)('never calls %s()', (api) => {
    const pattern = new RegExp(`\\b${api}\\s*\\(`)
    const offenders = pages.filter((page) =>
      pattern.test(code(readFileSync(join(DEMO, page), 'utf8'))),
    )
    expect(offenders, `${api}() called in: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('canvas & shields readback under resistFingerprinting (unit guard)', () => {
  const withFakeDom = async (
    targetSource: typeof canvasSource | typeof shieldsSource,
    nowResolution: number,
  ) => {
    let createdElement = false

    const fakeDoc = {
      createElement: () => {
        createdElement = true
        throw new Error('collector touched the DOM under RFP')
      },
    }

    const globals = globalThis as Record<string, unknown>
    const saved = { window: globals.window, document: globals.document }
    globals.window = { document: fakeDoc }
    globals.document = fakeDoc

    const ctx: SourceContext = {
      signal: new AbortController().signal,
      budgetRemainingMs: () => 350,
      completed: (id) =>
        id === SOURCE.timing
          ? { status: 'ok', ms: 1, value: { has_performance: true, now_resolution: nowResolution } }
          : undefined,
    }

    try {
      const thrown = await Promise.resolve()
        .then(() => targetSource.run(ctx))
        .then(
          () => undefined,
          (error: unknown) => error,
        )
      return { thrown, createdElement }
    } finally {
      globals.window = saved.window
      globals.document = saved.document
    }
  }

  it.each([16.667, 100])(
    'canvasSource and shieldsSource both decline without touching DOM when clock is clamped to %sms',
    async (nowResolution) => {
      for (const src of [canvasSource, shieldsSource]) {
        const { thrown, createdElement } = await withFakeDom(src, nowResolution)
        expect(thrown).toBeInstanceOf(BlockedSignal)
        expect((thrown as BlockedSignal).reason).toBe('rfp-canvas-prompt-avoided')
        expect(createdElement).toBe(false)
      }
    },
  )

  it('still reaches the DOM on an ordinary unclamped browser', async () => {
    const { createdElement } = await withFakeDom(canvasSource, 0.1)
    expect(createdElement).toBe(true)
  })
})

interface InstalledPromptAndPixelSpies {
  promptSpies: Record<string, ReturnType<typeof vi.fn>>
  pixelReadbackSpies: Record<string, ReturnType<typeof vi.fn>>
  enumerateDevicesSpy: ReturnType<typeof vi.fn>
  restore: () => void
}

function installRuntimePromptAndPixelSpies(): InstalledPromptAndPixelSpies {
  const restorers: (() => void)[] = []
  const globals = globalThis as Record<string, unknown>

  const setTemp = (holder: Record<string, unknown>, key: string, value: unknown) => {
    const hadOwn = Object.prototype.hasOwnProperty.call(holder, key)
    const prev = Object.getOwnPropertyDescriptor(holder, key)
    Object.defineProperty(holder, key, {
      value,
      configurable: true,
      writable: true,
    })
    restorers.push(() => {
      if (hadOwn && prev) {
        Object.defineProperty(holder, key, prev)
      } else {
        delete holder[key]
      }
    })
  }

  // Ensure prototype constructors exist so every spy is wired onto the live chain.
  const ensureProto = (name: string): Record<string, unknown> => {
    const existing = globals[name] as { prototype?: Record<string, unknown> } | undefined
    if (existing?.prototype) return existing.prototype
    class SyntheticWebIDL {}
    setTemp(globals, name, SyntheticWebIDL)
    setTemp(window as unknown as Record<string, unknown>, name, SyntheticWebIDL)
    return SyntheticWebIDL.prototype as unknown as Record<string, unknown>
  }

  const htmlCanvasProto = ensureProto('HTMLCanvasElement')
  const ctx2dProto = ensureProto('CanvasRenderingContext2D')
  const offscreenCanvasProto = ensureProto('OffscreenCanvas')
  const offscreenCtx2dProto = ensureProto('OffscreenCanvasRenderingContext2D')
  const webgl1Proto = ensureProto('WebGLRenderingContext')
  const webgl2Proto = ensureProto('WebGL2RenderingContext')

  const spyProtoMethod = (
    proto: Record<string, unknown>,
    method: string,
    impl: (...args: unknown[]) => unknown = () => undefined,
  ) => {
    const spy = vi.fn(impl)
    setTemp(proto, method, spy)
    return spy
  }

  const pixelReadbackSpies = {
    'HTMLCanvasElement.prototype.toDataURL': spyProtoMethod(
      htmlCanvasProto,
      'toDataURL',
      () => 'data:image/png;base64,',
    ),
    'HTMLCanvasElement.prototype.toBlob': spyProtoMethod(htmlCanvasProto, 'toBlob'),
    'OffscreenCanvas.prototype.convertToBlob': spyProtoMethod(
      offscreenCanvasProto,
      'convertToBlob',
      async () => new Blob(),
    ),
    'CanvasRenderingContext2D.prototype.getImageData': spyProtoMethod(
      ctx2dProto,
      'getImageData',
      (_x, _y, w, h) => ({ data: new Uint8ClampedArray(Number(w || 1) * Number(h || 1) * 4) }),
    ),
    'OffscreenCanvasRenderingContext2D.prototype.getImageData': spyProtoMethod(
      offscreenCtx2dProto,
      'getImageData',
      (_x, _y, w, h) => ({ data: new Uint8ClampedArray(Number(w || 1) * Number(h || 1) * 4) }),
    ),
    'WebGLRenderingContext.prototype.readPixels': spyProtoMethod(webgl1Proto, 'readPixels'),
    'WebGL2RenderingContext.prototype.readPixels': spyProtoMethod(webgl2Proto, 'readPixels'),
  }

  // Notification.requestPermission + DeviceMotionEvent.requestPermission
  const notificationRequestPermission = vi.fn(async () => 'denied' as NotificationPermission)
  setTemp(globals, 'Notification', {
    permission: 'default',
    requestPermission: notificationRequestPermission,
  })
  setTemp(window as unknown as Record<string, unknown>, 'Notification', globals.Notification)

  const motionRequestPermission = vi.fn(async () => 'denied')
  class FakeDeviceMotionEvent {}
  ;(FakeDeviceMotionEvent as unknown as Record<string, unknown>).requestPermission =
    motionRequestPermission
  setTemp(globals, 'DeviceMotionEvent', FakeDeviceMotionEvent)
  setTemp(window as unknown as Record<string, unknown>, 'DeviceMotionEvent', FakeDeviceMotionEvent)

  // navigator.geolocation, navigator.mediaDevices (preserving enumerateDevices!), navigator.clipboard
  const getCurrentPosition = vi.fn()
  const watchPosition = vi.fn()
  setTemp(navigator as unknown as Record<string, unknown>, 'geolocation', {
    getCurrentPosition,
    watchPosition,
  })

  const getUserMedia = vi.fn(async () => ({}))
  const getDisplayMedia = vi.fn(async () => ({}))
  const enumerateDevicesSpy = vi.fn(async () => [
    { kind: 'audiooutput', label: '', deviceId: '', groupId: '', toJSON: () => ({}) },
  ])
  setTemp(navigator as unknown as Record<string, unknown>, 'mediaDevices', {
    getUserMedia,
    getDisplayMedia,
    enumerateDevices: enumerateDevicesSpy,
  })

  const clipboardReadText = vi.fn(async () => '')
  const clipboardRead = vi.fn(async () => [])
  setTemp(navigator as unknown as Record<string, unknown>, 'clipboard', {
    readText: clipboardReadText,
    read: clipboardRead,
  })

  const queryLocalFonts = vi.fn(async () => [])
  setTemp(window as unknown as Record<string, unknown>, 'queryLocalFonts', queryLocalFonts)
  setTemp(globals, 'queryLocalFonts', queryLocalFonts)

  const promptSpies = {
    'Notification.requestPermission': notificationRequestPermission,
    'DeviceMotionEvent.requestPermission': motionRequestPermission,
    'navigator.geolocation.getCurrentPosition': getCurrentPosition,
    'navigator.geolocation.watchPosition': watchPosition,
    'navigator.mediaDevices.getUserMedia': getUserMedia,
    'navigator.mediaDevices.getDisplayMedia': getDisplayMedia,
    'navigator.clipboard.readText': clipboardReadText,
    'navigator.clipboard.read': clipboardRead,
    'window.queryLocalFonts': queryLocalFonts,
  }

  return {
    promptSpies,
    pixelReadbackSpies,
    enumerateDevicesSpy,
    restore: () => {
      for (const fn of restorers.reverse()) fn()
    },
  }
}

describe('full runtime pipeline prompt & Gecko RFP pixel-readback spies', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['16.67ms Firefox/Tor Standard step', 16.67],
    ['100ms Firefox RFP / Tor Safest step', 100],
    ['0ms stalled clock step', 0],
  ])(
    'invokes ZERO pixel readbacks or permission prompts on Gecko under %s across identify() and collect()',
    async (_label, stepMs) => {
      const spies = installRuntimePromptAndPixelSpies()
      try {
        // Configure Gecko environment (Firefox UA + MozAppearance on root style).
        Object.defineProperty(navigator, 'userAgent', {
          value: 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0',
          configurable: true,
        })
        Object.defineProperty(document.documentElement.style, 'MozAppearance', {
          value: 'none',
          configurable: true,
        })

        let currentNow = 1000
        vi.spyOn(performance, 'now').mockImplementation(() => {
          currentNow += stepMs
          return currentNow
        })

        // Also wire document.createElement('canvas') so if the RFP gate ever
        // failed to block, getContext('2d').getImageData / toDataURL spies WOULD fire!
        const origCreateElement = document.createElement.bind(document)
        vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
          if (tag === 'canvas') {
            return {
              width: 0,
              height: 0,
              toDataURL: spies.pixelReadbackSpies['HTMLCanvasElement.prototype.toDataURL'],
              toBlob: spies.pixelReadbackSpies['HTMLCanvasElement.prototype.toBlob'],
              getContext: (kind: string) => {
                if (kind === '2d') {
                  return {
                    globalCompositeOperation: 'source-over',
                    fillStyle: '',
                    font: '',
                    textBaseline: 'alphabetic',
                    fillRect: () => undefined,
                    fillText: () => undefined,
                    beginPath: () => undefined,
                    arc: () => undefined,
                    closePath: () => undefined,
                    fill: () => undefined,
                    rect: () => undefined,
                    isPointInPath: () => false,
                    getImageData:
                      spies.pixelReadbackSpies['CanvasRenderingContext2D.prototype.getImageData'],
                  }
                }
                if (kind === 'webgl' || kind === 'experimental-webgl') {
                  return {
                    VENDOR: 0x1f00,
                    RENDERER: 0x1f01,
                    VERSION: 0x1f02,
                    SHADING_LANGUAGE_VERSION: 0x8b8c,
                    MAX_TEXTURE_SIZE: 0x0d33,
                    MAX_RENDERBUFFER_SIZE: 0x84e8,
                    VERTEX_SHADER: 0x8b31,
                    FRAGMENT_SHADER: 0x8b30,
                    LOW_FLOAT: 0x8df0,
                    MEDIUM_FLOAT: 0x8df1,
                    HIGH_FLOAT: 0x8df2,
                    getExtension: (ext: string) =>
                      ext === 'WEBGL_lose_context' ? { loseContext: () => undefined } : null,
                    getParameter: () => 'Mozilla',
                    getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
                    getSupportedExtensions: () => ['WEBGL_lose_context'],
                    readPixels:
                      spies.pixelReadbackSpies['WebGLRenderingContext.prototype.readPixels'],
                  }
                }
                return null
              },
            } as unknown as HTMLElement
          }
          return origCreateElement(tag)
        }) as typeof document.createElement)

        const submitted: IdentifySubmission[] = []
        const client = await load({
          apiKey: 'fly_pk_development_test',
          consent: 'granted',
          // The stepped clock advances on every read, so how much budget the
          // sources use depends on how often they read it, not on time. This
          // test is about prompts and readbacks, so the budget stays out of it.
          schedule: { budgetMs: 600_000 },
          transport: {
            submit: async (submission: IdentifySubmission) => {
              submitted.push(submission)
              return {
              request_id: 'req_rfp',
              visitor_id: '',
              identifiable: false,
              state: 'enriched',
              }
            },
          },
        })

        const collected = await client.collect()
        await client.identify()
        const identified = { report: submitted[0]!.signals }

        for (const [name, spy] of Object.entries(spies.promptSpies)) {
          expect(spy, `prompt API ${name} must never be called`).not.toHaveBeenCalled()
        }
        for (const [name, spy] of Object.entries(spies.pixelReadbackSpies)) {
          expect(spy, `pixel readback ${name} must not be called on clamped Gecko`).not.toHaveBeenCalled()
        }

        // Non-prompting enumerateDevices() must remain functional!
        expect(spies.enumerateDevicesSpy).toHaveBeenCalled()
        expect(collected.sources.media_devices?.status).toBe('ok')

        for (const report of [collected, identified.report]) {
          expect(report.sources.shields).toMatchObject({
            status: 'blocked',
            reason: 'rfp-canvas-prompt-avoided',
          })
          expect(report.sources.canvas).toMatchObject({
            status: 'blocked',
            reason: 'rfp-canvas-prompt-avoided',
          })
          expect(report.sources.engine).toMatchObject({
            status: 'ok',
            value: expect.objectContaining({ has_motion_permission_fn: true }),
          })
        }
      } finally {
        delete (document.documentElement.style as unknown as Record<string, unknown>).MozAppearance
        spies.restore()
      }
    },
  )

  it('never calls prompting APIs, toDataURL, toBlob, convertToBlob, or readPixels on an unlocked browser', async () => {
    const spies = installRuntimePromptAndPixelSpies()
    try {
      const client = await load({
        apiKey: 'fly_pk_development_test',
        consent: 'granted',
        transport: {
          submit: async () => ({
            request_id: 'req_std',
            visitor_id: 'vis_std',
            identifiable: true,
            state: 'enriched',
          }),
        },
      })

      await client.identify({ incognitoDetection: 'extended' })

      for (const [name, spy] of Object.entries(spies.promptSpies)) {
        expect(spy, `prompt API ${name} must never be called`).not.toHaveBeenCalled()
      }
      expect(
        spies.pixelReadbackSpies['HTMLCanvasElement.prototype.toDataURL'],
      ).not.toHaveBeenCalled()
      expect(spies.pixelReadbackSpies['HTMLCanvasElement.prototype.toBlob']).not.toHaveBeenCalled()
      expect(
        spies.pixelReadbackSpies['OffscreenCanvas.prototype.convertToBlob'],
      ).not.toHaveBeenCalled()
      expect(
        spies.pixelReadbackSpies['WebGLRenderingContext.prototype.readPixels'],
      ).not.toHaveBeenCalled()
      expect(
        spies.pixelReadbackSpies['WebGL2RenderingContext.prototype.readPixels'],
      ).not.toHaveBeenCalled()
      expect(spies.enumerateDevicesSpy).toHaveBeenCalled()
    } finally {
      spies.restore()
    }
  })
})
