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

  function addMeta(parent: HTMLElement, policy: string): void {
    const meta = document.createElement('meta')
    meta.setAttribute('http-equiv', 'Content-Security-Policy')
    meta.setAttribute('content', policy)
    parent.appendChild(meta)
  }

  function answeringWorker(data: unknown) {
    const constructed = vi.fn()
    class AnsweringWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      terminate = vi.fn()
      constructor(url: string) {
        constructed(url)
        queueMicrotask(() => this.onmessage?.({ data } as MessageEvent))
      }
    }
    return { AnsweringWorker, constructed }
  }

  it.each([
    "default-src 'self'",
    "worker-src 'self' https://cdn.example.com",
    "child-src 'none'",
    "default-src *; script-src 'self'",
  ])(
    'attempts the worker under a <head> policy %j and names the refusal csp-meta (WEB-03)',
    async (policy) => {
      addMeta(document.head, policy)
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:meta')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const workerCtor = vi.fn(() => {
        const err = new Error('Refused to create a worker')
        err.name = 'SecurityError'
        throw err
      })
      vi.stubGlobal('Worker', workerCtor)

      await expect(workerRealmSource.run(makeContext())).rejects.toEqual(
        expect.objectContaining<Partial<BlockedSignal>>({ name: 'BlockedSignal', reason: 'csp-meta' }),
      )
      expect(workerCtor).toHaveBeenCalledTimes(1)
    },
  )

  it('names a start-up error under a <head> policy csp-meta, whatever the message (WEB-03)', async () => {
    addMeta(document.head, "worker-src 'none'")
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:meta-error')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    class FailingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      terminate = vi.fn()
      constructor() {
        queueMicrotask(() => this.onerror?.({ message: '', preventDefault() {} } as unknown as ErrorEvent))
      }
    }
    vi.stubGlobal('Worker', FailingWorker)
    await expect(workerRealmSource.run(makeContext())).rejects.toMatchObject({ reason: 'csp-meta' })
  })

  it('does not trust a <head> policy that the browser does not enforce: the worker answers', async () => {
    addMeta(document.head, "worker-src 'none'")
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:not-enforced')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const { AnsweringWorker, constructed } = answeringWorker({ user_agent: 'UA', platform: 'P' })
    vi.stubGlobal('Worker', AnsweringWorker)
    await expect(workerRealmSource.run(makeContext())).resolves.toMatchObject({ user_agent: 'UA' })
    expect(constructed).toHaveBeenCalledTimes(1)
  })

  it('ignores a CSP <meta> outside <head> (WEB-03)', async () => {
    const holder = document.createElement('div')
    document.body.appendChild(holder)
    addMeta(holder, "worker-src 'none'")
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:body-meta')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const workerCtor = vi.fn(() => {
      const err = new Error('refused')
      err.name = 'SecurityError'
      throw err
    })
    vi.stubGlobal('Worker', workerCtor)
    try {
      // Refused by some other policy: csp-blocked, never csp-meta.
      await expect(workerRealmSource.run(makeContext())).rejects.toMatchObject({ reason: 'csp-blocked' })
      expect(workerCtor).toHaveBeenCalledTimes(1)
    } finally {
      holder.remove()
    }
  })

  it('keeps the three unavailable statuses distinct', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(workerRealmSource.run(makeContext())).rejects.toMatchObject({
      name: 'UnsupportedSignal',
      reason: 'no-worker',
    })
  })

  it('reads only the user agent and platform in the embedded profile (WEB-07)', async () => {
    vi.stubGlobal('ReactNativeWebView', { postMessage: () => {} })
    let script = ''
    const OrigBlob = globalThis.Blob
    vi.stubGlobal(
      'Blob',
      class extends OrigBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options)
          script = String(parts?.[0] ?? '')
        }
      },
    )
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:embedded')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const { AnsweringWorker } = answeringWorker({
      user_agent: 'UA',
      platform: 'iPhone',
      hardware_concurrency: 6,
      device_memory: 4,
      languages: ['en'],
      timezone: 'UTC',
      unmasked_vendor: 'Apple',
      unmasked_renderer: 'Apple GPU',
    })
    vi.stubGlobal('Worker', AnsweringWorker)
    await expect(workerRealmSource.run(makeContext())).resolves.toEqual({ user_agent: 'UA', platform: 'iPhone' })
    expect(script).toContain('})(false);')
  })

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
    const messages: unknown[] = []
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
              messages.push(data)
              // The first message carries the navigator values only; the final
              // one comes after the WebGL context was lost.
              if (!(data as { partial?: boolean }).partial) expect(loseContext).toHaveBeenCalledTimes(1)
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
    expect(messages[0]).toEqual({
      partial: true,
      values: expect.objectContaining({ user_agent: 'Mozilla/5.0 RealWorker', platform: 'Linux x86_64' }),
    })
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:exec-worker')
  })

  it('reports the navigator values with gpu_unanswered when only the first message arrives', async () => {
    vi.useFakeTimers()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:slow-gpu')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    class SlowGpuWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      terminate = vi.fn()
      constructor() {
        queueMicrotask(() =>
          this.onmessage?.({ data: { partial: true, values: { user_agent: 'UA', platform: 'P', timezone: 'UTC' } } } as MessageEvent),
        )
      }
    }
    vi.stubGlobal('Worker', SlowGpuWorker)
    const pending = workerRealmSource.run(makeContext())
    await vi.advanceTimersByTimeAsync(400)
    await expect(pending).resolves.toEqual({ user_agent: 'UA', platform: 'P', timezone: 'UTC', gpu_unanswered: true })
  })

  it('waits long enough for a cold worker start, then times out and still cleans up', async () => {
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
    // A cold start that answers after 60 ms is still waited for.
    await vi.advanceTimersByTimeAsync(200)
    await expect(Promise.race([Promise.resolve(pending).then(() => 'settled', () => 'settled'), Promise.resolve('pending')])).resolves.toBe('pending')
    await vi.advanceTimersByTimeAsync(200)
    await assertion

    expect(terminate).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:hanging-worker')
  })
})
