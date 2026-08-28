/**
 * The binding, in a real application injector.
 *
 * `@badele/web-js`'s `load()` is mocked, because what is under test is the
 * Angular layer - providers, injection context, signals, the render hook - and
 * not whether a canvas hashes. The browser SDK has its own tests for that.
 *
 * TestBed rather than a hand-built injector: `afterNextRender` needs an
 * application to render, and that is precisely the thing `immediate` depends
 * on being real.
 */

import { ApplicationRef, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@badele/web-js', () => ({
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
}))

const { provideBadele } = await import('../src/provide.js')
const { injectBadele, injectIdentify, injectVerdict } = await import('../src/inject.js')
const { createBadele } = await import('../src/state.js')

const verdict = (value: boolean, confidence: 'low' | 'medium' | 'high', reasons: string[] = []) => ({
  value,
  confidence,
  reasons,
})

const RESULT = {
  requestId: 'req_1',
  verdicts: {
    incognito: verdict(true, 'medium', ['firefox-private-origin-filesystem-refused']),
    tor: verdict(false, 'low'),
    emulator: verdict(false, 'low'),
    automation: verdict(true, 'high', ['patched-natives-3']),
    farm: verdict(false, 'low'),
  },
  report: { schema: 1, sources: {}, elapsed_ms: 26 },
}

/** Configure an application with the SDK provided, as an app's config would. */
function application(options: Parameters<typeof provideBadele>[0]) {
  TestBed.configureTestingModule({ providers: [provideBadele(options)] })
}

/** What Angular does after the first render, and what the browser then does. */
async function render(): Promise<void> {
  TestBed.inject(ApplicationRef).tick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  TestBed.resetTestingModule()
  vi.clearAllMocks()
  identifyMock.mockResolvedValue(RESULT)
  loadMock.mockResolvedValue({ identify: identifyMock })
})

describe('provideBadele', () => {
  it('collects nothing when the application starts', () => {
    application({ apiKey: 'pk_test' })
    TestBed.runInInjectionContext(() => injectBadele())

    // Providing makes the client reachable and no more. A provider that
    // fingerprinted as the injector built it would collect during every server
    // render too.
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('passes the endpoint through, and omits it when unset', async () => {
    application({ apiKey: 'pk_test', endpoint: 'http://localhost:8099' })
    const badele = TestBed.runInInjectionContext(() => injectBadele())

    await badele.identify()

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_test', endpoint: 'http://localhost:8099' })
  })

  it('builds the state once for the whole application', async () => {
    application({ apiKey: 'pk_test' })

    const first = TestBed.runInInjectionContext(() => injectBadele())
    const second = TestBed.runInInjectionContext(() => injectBadele())

    // The same object, not two with the same values: one identification per
    // page is a property of the injector, not of a cache.
    expect(second).toBe(first)

    await first.identify()
    await second.identify()

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })
})

describe('injectBadele', () => {
  it('explains itself when nothing provided it', () => {
    TestBed.configureTestingModule({ providers: [] })

    expect(() => TestBed.runInInjectionContext(() => injectBadele())).toThrow(
      /No Badele provider found/,
    )
    expect(() => TestBed.runInInjectionContext(() => injectBadele())).toThrow(/provideBadele/)
  })
})

describe('injectIdentify', () => {
  it('collects after the first render when immediate is set', async () => {
    application({ apiKey: 'pk_test' })
    const badele = TestBed.runInInjectionContext(() => injectIdentify({ immediate: true }))

    // Nothing yet: afterNextRender has not run, which is also why a server
    // render collects nothing.
    expect(badele.isReady()).toBe(false)
    expect(identifyMock).not.toHaveBeenCalled()

    await render()

    expect(badele.isReady()).toBe(true)
    expect(badele.requestId()).toBe('req_1')
    expect(badele.isSuspicious()).toBe(true)
    expect(badele.isLoading()).toBe(false)
    expect(badele.error()).toBeNull()
  })

  it('shares one identification across every component that asks', async () => {
    application({ apiKey: 'pk_test' })

    const components = [1, 2, 3].map(() =>
      TestBed.runInInjectionContext(() => injectIdentify({ immediate: true })),
    )
    await render()

    expect(identifyMock).toHaveBeenCalledTimes(1)
    for (const component of components) expect(component.requestId()).toBe('req_1')
  })

  it('reuses a finished identification rather than repeating it', async () => {
    application({ apiKey: 'pk_test' })
    const badele = TestBed.runInInjectionContext(() => injectIdentify())

    await badele.identify()
    await badele.identify()

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh one on refresh()', async () => {
    application({ apiKey: 'pk_test' })
    const badele = TestBed.runInInjectionContext(() => injectIdentify())

    await badele.identify()
    await badele.refresh()

    expect(identifyMock).toHaveBeenCalledTimes(2)
  })

  it('reads a tag signal at submission time, not at construction time', async () => {
    application({ apiKey: 'pk_test' })
    const orderId = signal('order_1')
    const badele = TestBed.runInInjectionContext(() => injectIdentify({ tag: orderId }))

    orderId.set('order_2')
    await badele.identify()

    expect(identifyMock).toHaveBeenCalledWith({ tag: 'order_2' })
  })

  it('records a failure without leaving an unhandled rejection', async () => {
    identifyMock.mockRejectedValue(new Error('collector exploded'))
    application({ apiKey: 'pk_test' })
    const badele = TestBed.runInInjectionContext(() => injectIdentify({ immediate: true }))

    await render()

    expect(badele.error()?.message).toBe('collector exploded')
    expect(badele.isReady()).toBe(true)
    expect(badele.isLoading()).toBe(false)
  })

  it('retries after a failure rather than serving the rejection forever', async () => {
    identifyMock.mockRejectedValueOnce(new Error('collector exploded'))
    application({ apiKey: 'pk_test' })
    const badele = TestBed.runInInjectionContext(() => injectIdentify())

    await badele.identify().catch(() => undefined)
    await badele.identify()

    expect(identifyMock).toHaveBeenCalledTimes(2)
    expect(badele.requestId()).toBe('req_1')
  })

  it('leaves requestId null when submit is off, and still shares the run', async () => {
    identifyMock.mockResolvedValue({ ...RESULT, requestId: '' })
    application({ apiKey: 'pk_test', submit: false })

    const first = TestBed.runInInjectionContext(() => injectIdentify({ immediate: true }))
    const second = TestBed.runInInjectionContext(() => injectIdentify({ immediate: true }))
    await render()

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(identifyMock).toHaveBeenCalledWith({ submit: false })
    expect(first.requestId()).toBeNull()
    expect(second.report()).not.toBeNull()
  })
})

describe('injectVerdict', () => {
  it('reports one verdict and its reasons', async () => {
    application({ apiKey: 'pk_test' })
    const { incognito, badele } = TestBed.runInInjectionContext(() => ({
      badele: injectIdentify({ immediate: true }),
      incognito: injectVerdict('incognito'),
    }))
    await render()

    expect(badele.isReady()).toBe(true)
    expect(incognito.matched()).toBe(true)
    expect(incognito.confidence()).toBe('medium')
    expect(incognito.reasons()).toEqual(['firefox-private-origin-filesystem-refused'])
  })

  it('honours a confidence floor', async () => {
    application({ apiKey: 'pk_test' })
    const incognito = TestBed.runInInjectionContext(() => {
      injectIdentify({ immediate: true })
      return injectVerdict('incognito', { min: 'high' })
    })
    await render()

    // Fired, but at medium - not enough to act on when high was asked for.
    expect(incognito.verdict()?.value).toBe(true)
    expect(incognito.matched()).toBe(false)
  })

  it('follows a signal, so an input can change which verdict is watched', async () => {
    application({ apiKey: 'pk_test' })
    const name = signal<'tor' | 'automation'>('tor')
    const watched = TestBed.runInInjectionContext(() => {
      injectIdentify({ immediate: true })
      return injectVerdict(name)
    })
    await render()

    expect(watched.matched()).toBe(false)

    name.set('automation')

    expect(watched.matched()).toBe(true)
    expect(watched.reasons()).toEqual(['patched-natives-3'])
  })

  it('reports nothing rather than guessing before identification', () => {
    application({ apiKey: 'pk_test' })
    const incognito = TestBed.runInInjectionContext(() => injectVerdict('incognito'))

    expect(incognito.verdict()).toBeNull()
    expect(incognito.confidence()).toBeNull()
    expect(incognito.matched()).toBe(false)
    expect(incognito.reasons()).toEqual([])
  })
})

describe('the state itself', () => {
  it('hands out signals that a component cannot write to', () => {
    const badele = createBadele({ apiKey: 'pk_test' })

    // The writable signals stay in the factory's closure. The state is shared,
    // so a component that could set() it would be changing what every other
    // component sees.
    expect('set' in badele.requestId).toBe(false)
    expect('update' in badele.isLoading).toBe(false)
  })
})
