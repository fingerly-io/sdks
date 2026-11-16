// @vitest-environment happy-dom

import { BlockedSignal, TimedOutSignal, type SourceContext } from '@fingerly/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetWorkerRealmCspCache, workerRealmSource } from '../src/sources/worker_realm.js'

function makeContext(): SourceContext {
  return {
    signal: new AbortController().signal,
    budgetRemainingMs: () => 350,
    completed: () => undefined,
    shared: new Map(),
  }
}

describe('workerRealmSource (CSP-safe isolated Blob Worker realm)', () => {
  afterEach(() => {
    document.head.innerHTML = ''
    resetWorkerRealmCspCache()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.each([
    "default-src 'self'",
    "worker-src 'self' https://cdn.example.com",
    "child-src 'none'",
    "default-src *; script-src 'self'",
  ])(
    'returns blocked("csp-meta") without calling new Worker when <meta CSP> is %j',
    async (policy) => {
      const meta = document.createElement('meta')
      meta.setAttribute('http-equiv', 'Content-Security-Policy')
      meta.setAttribute('content', policy)
      document.head.appendChild(meta)

      const workerSpy = vi.fn()
      vi.stubGlobal('Worker', workerSpy)

      await expect(workerRealmSource.run(makeContext())).rejects.toEqual(
        expect.objectContaining<Partial<BlockedSignal>>({
          name: 'BlockedSignal',
          reason: 'csp-meta',
        }),
      )
      expect(workerSpy).not.toHaveBeenCalled()
    },
  )

  it('allows spawning a Blob Worker when <meta CSP> worker-src explicitly permits blob:', async () => {
    const meta = document.createElement('meta')
    meta.setAttribute('http-equiv', 'Content-Security-Policy')
    meta.setAttribute('content', "default-src 'self'; worker-src 'self' blob:")
    document.head.appendChild(meta)

    const terminate = vi.fn()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-1')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      terminate = terminate
      constructor(_url: string) {
        queueMicrotask(() => {
          this.onmessage?.({
            data: {
              user_agent: 'Mozilla/5.0 Worker',
              platform: 'MacIntel',
              hardware_concurrency: 8,
              device_memory: 8,
              languages: ['en-US'],
              timezone: 'UTC',
              unmasked_vendor: 'Apple Inc.',
              unmasked_renderer: 'Apple M3',
            },
          } as MessageEvent)
        })
      }
    }
    vi.stubGlobal('Worker', MockWorker)

    const result = await workerRealmSource.run(makeContext())
    expect(result).toEqual({
      user_agent: 'Mozilla/5.0 Worker',
      platform: 'MacIntel',
      hardware_concurrency: 8,
      device_memory: 8,
      languages: ['en-US'],
      timezone: 'UTC',
      unmasked_vendor: 'Apple Inc.',
      unmasked_renderer: 'Apple M3',
    })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
  })

  it('memoizes CSP SecurityError per session so subsequent calls skip new Worker', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sec-err')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const workerCtor = vi.fn(() => {
      const err = new Error("Refused to create a worker from 'blob:...' because it violates CSP")
      err.name = 'SecurityError'
      throw err
    })
    vi.stubGlobal('Worker', workerCtor)

    await expect(workerRealmSource.run(makeContext())).rejects.toEqual(
      expect.objectContaining<Partial<BlockedSignal>>({
        name: 'BlockedSignal',
        reason: 'csp-blocked',
      }),
    )
    expect(workerCtor).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:sec-err')

    // Second call in same session returns memoized csp-blocked without creating a Blob or Worker!
    await expect(workerRealmSource.run(makeContext())).rejects.toEqual(
      expect.objectContaining<Partial<BlockedSignal>>({
        name: 'BlockedSignal',
        reason: 'csp-blocked',
      }),
    )
    expect(workerCtor).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('executes the inline worker script, calls WEBGL_lose_context.loseContext(), and cleans up', async () => {
    let capturedBlobParts: BlobPart[] = []
    const OrigBlob = globalThis.Blob
    vi.stubGlobal(
      'Blob',
      class extends OrigBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options)
          capturedBlobParts = parts ? [...parts] : []
        }
      },
    )

    const loseContext = vi.fn()
    const terminate = vi.fn()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:exec-worker')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    class ExecutingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      terminate = terminate
      constructor() {
        queueMicrotask(() => {
          const script = String(capturedBlobParts[0] ?? '')
          const workerScope = {
            navigator: {
              userAgent: 'Mozilla/5.0 RealWorker',
              platform: 'Linux x86_64',
              hardwareConcurrency: 4,
              deviceMemory: 4,
              languages: ['en-GB', 'en'],
            },
            Intl,
            OffscreenCanvas: class {
              getContext() {
                return {
                  getExtension(name: string) {
                    if (name === 'WEBGL_debug_renderer_info') {
                      return { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 }
                    }
                    if (name === 'WEBGL_lose_context') {
                      return { loseContext }
                    }
                    return null
                  },
                  getParameter(param: number) {
                    if (param === 0x9245) return 'Mesa'
                    if (param === 0x9246) return 'llvmpipe'
                    return null
                  },
                }
              }
            },
            postMessage: (data: unknown) => {
              // loseContext MUST already have been called before postMessage!
              expect(loseContext).toHaveBeenCalledTimes(1)
              this.onmessage?.({ data } as MessageEvent)
            },
          }
          const fn = new Function(
            'navigator',
            'Intl',
            'OffscreenCanvas',
            'self',
            script,
          )
          fn(
            workerScope.navigator,
            workerScope.Intl,
            workerScope.OffscreenCanvas,
            workerScope,
          )
        })
      }
    }
    vi.stubGlobal('Worker', ExecutingWorker)

    const result = await workerRealmSource.run(makeContext())
    expect(loseContext).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      user_agent: 'Mozilla/5.0 RealWorker',
      platform: 'Linux x86_64',
      hardware_concurrency: 4,
      device_memory: 4,
      languages: ['en-GB', 'en'],
      unmasked_vendor: 'Mesa',
      unmasked_renderer: 'llvmpipe',
    })
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:exec-worker')
  })

  it('enforces a 60ms worker timeout and still terminates worker + revokes blobUrl in finally', async () => {
    vi.useFakeTimers()
    const terminate = vi.fn()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hanging-worker')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    class HangingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      terminate = terminate
    }
    vi.stubGlobal('Worker', HangingWorker)

    const pending = workerRealmSource.run(makeContext())
    const assertion = expect(pending).rejects.toBeInstanceOf(TimedOutSignal)
    await vi.advanceTimersByTimeAsync(60)
    await assertion

    expect(terminate).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:hanging-worker')
  })
})
